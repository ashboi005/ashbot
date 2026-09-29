import type { ChatMessage, ContentPart, LlmClient, ToolCall } from "./llm";
import { prepareOutput, type Redactor } from "./output";
import { fallbackReport, reportSchema, type Report } from "./report";
import { defineTool, parseArgs, toFunctionSpec, type AnyTool, type FunctionTool } from "./tool";

export type Caps = { maxToolCalls: number; maxWallClockMs: number; maxTokens: number };

export const DEFAULT_CAPS: Caps = { maxToolCalls: 40, maxWallClockMs: 10 * 60_000, maxTokens: 1_000_000 };

export type ToolCallRecord = { name: string; input: unknown; output: string; isError: boolean; durationMs: number };

export type StopReason = "submitted" | "cap_reached" | "no_report";

export type InvestigationResult = {
  report: Report;
  stopReason: StopReason;
  toolCalls: ToolCallRecord[];
  usage: { promptTokens: number; completionTokens: number };
};

export type RunOptions = {
  llm: LlmClient;
  tools: AnyTool[];
  systemPrompt: string;
  userContent: string | ContentPart[];
  caps?: Partial<Caps>;
  redact?: Redactor;
  maxOutputBytes?: number;
  now?: () => number;
  onToolCall?: (record: ToolCallRecord) => void;
};

export const SUBMIT_REPORT = "submit_report";

const MAX_NUDGES = 2;
const DEFAULT_MAX_OUTPUT_BYTES = 20_000;
const NUDGE = "Continue the investigation with the tools, or call submit_report to finish.";
const FINAL_TURN =
  'Investigation budget exhausted. Call submit_report now. Use status "inconclusive" unless the evidence already supports more, and list what you checked and what you did not.';

const submitTool = defineTool({
  name: SUBMIT_REPORT,
  description:
    "Finish the investigation with the final report. At most two hypotheses, each with evidence (snapshot ids like snap_3, exact log lines, or queries).",
  input: reportSchema,
  run: async () => "Report received.",
});

export async function runInvestigation(opts: RunOptions): Promise<InvestigationResult> {
  const caps = { ...DEFAULT_CAPS, ...opts.caps };
  const now = opts.now ?? Date.now;
  const redact = opts.redact ?? ((text: string) => text);
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = now();

  const toolCalls: ToolCallRecord[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  const byName = new Map(opts.tools.map((tool) => [tool.name, tool]));
  const allSpecs = [...opts.tools, submitTool].map(toFunctionSpec);
  const submitOnly = [toFunctionSpec(submitTool)];
  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userContent },
  ];

  const finish = (report: Report, stopReason: StopReason): InvestigationResult => ({ report, stopReason, toolCalls, usage });
  const fallback = (reason: string) => fallbackReport(toolCalls.map((r) => r.name), reason);

  const capReached = () =>
    toolCalls.length >= caps.maxToolCalls ||
    now() - startedAt >= caps.maxWallClockMs ||
    usage.promptTokens + usage.completionTokens >= caps.maxTokens;

  const ask = async (tools: FunctionTool[]) => {
    const completion = await opts.llm.complete({ messages, tools });
    usage.promptTokens += completion.usage.promptTokens;
    usage.completionTokens += completion.usage.completionTokens;
    messages.push(completion.message);
    return completion.message;
  };

  const execute = async (toolCall: ToolCall): Promise<string> => {
    const started = now();
    const name = toolCall.function.name;
    const tool = byName.get(name);
    let input: unknown = toolCall.function.arguments;
    let output: string;
    let isError = true;

    if (!tool) {
      output = `Error: unknown tool "${name}". Available tools: ${[...byName.keys(), SUBMIT_REPORT].join(", ")}.`;
    } else {
      const parsed = parseArgs(toolCall.function.arguments, tool.input);
      if (!parsed.ok) {
        output = `Error: ${parsed.error}`;
      } else {
        input = parsed.value;
        try {
          output = prepareOutput(await tool.run(parsed.value), { redact, maxBytes });
          isError = false;
        } catch (err) {
          output = prepareOutput(`Error: ${err instanceof Error ? err.message : String(err)}`, { redact, maxBytes });
        }
      }
    }

    const record: ToolCallRecord = { name, input, output, isError, durationMs: now() - started };
    toolCalls.push(record);
    opts.onToolCall?.(record);
    return output;
  };

  // Returns the report if a valid submit_report arrived; otherwise appends tool results.
  const handle = async (batch: ToolCall[], onlySubmit: boolean): Promise<Report | undefined> => {
    let report: Report | undefined;
    let budget = caps.maxToolCalls - toolCalls.length;

    const results = await Promise.all(
      batch.map(async (toolCall) => {
        if (toolCall.function.name === SUBMIT_REPORT) {
          const parsed = parseArgs(toolCall.function.arguments, reportSchema);
          if (parsed.ok) {
            report ??= parsed.value;
            return { id: toolCall.id, content: "Report received." };
          }
          return { id: toolCall.id, content: `Error: ${parsed.error}` };
        }
        if (onlySubmit) return { id: toolCall.id, content: "Error: only submit_report is allowed now." };
        if (budget <= 0) return { id: toolCall.id, content: "Error: tool-call budget exhausted. Call submit_report." };
        budget--;
        return { id: toolCall.id, content: await execute(toolCall) };
      }),
    );

    if (report) return report;
    for (const result of results) messages.push({ role: "tool", tool_call_id: result.id, content: result.content });
    return undefined;
  };

  let nudges = 0;
  while (!capReached()) {
    const message = await ask(allSpecs);
    const batch = message.tool_calls ?? [];
    if (batch.length === 0) {
      if (nudges >= MAX_NUDGES) return finish(fallback("The model stopped without submitting a report."), "no_report");
      nudges++;
      messages.push({ role: "user", content: NUDGE });
      continue;
    }
    const report = await handle(batch, false);
    if (report) return finish(report, "submitted");
  }

  messages.push({ role: "user", content: FINAL_TURN });
  const final = await ask(submitOnly);
  const report = await handle(final.tool_calls ?? [], true);
  return finish(report ?? fallback("Investigation budget exhausted before a report was submitted."), "cap_reached");
}
