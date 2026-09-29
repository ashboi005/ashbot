import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { runInvestigation } from "./harness";
import type { AssistantMessage, ChatMessage, LlmClient, ToolCall } from "./llm";
import { createRedactor } from "./output";
import type { Report } from "./report";
import { defineTool, type FunctionTool } from "./tool";

function scriptedLlm(steps: AssistantMessage[]) {
  const requests: { messages: ChatMessage[]; tools: FunctionTool[] }[] = [];
  let index = 0;
  const llm: LlmClient = {
    async complete(req) {
      requests.push({ messages: structuredClone(req.messages), tools: req.tools });
      const message = steps[index++] ?? { role: "assistant", content: "no more scripted steps" };
      return { message, usage: { promptTokens: 10, completionTokens: 5 } };
    },
  };
  return { llm, requests };
}

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const calls = (...toolCalls: ToolCall[]): AssistantMessage => ({ role: "assistant", content: null, tool_calls: toolCalls });
const text = (content: string): AssistantMessage => ({ role: "assistant", content });

const report: Report = {
  title: "Pool exhausted",
  severity: "high",
  status: "likely",
  hypotheses: [{ claim: "DB pool exhausted", evidence: ["snap_1"] }],
  nextSteps: ["Raise pool size"],
  coverage: { checked: ["echo"], notChecked: [] },
};

const echo = defineTool({
  name: "echo",
  description: "Echo text",
  input: z.object({ text: z.string() }),
  run: async ({ text: value }) => ({ echoed: value }),
});

const toolMessages = (messages: ChatMessage[]) => messages.filter((m) => m.role === "tool");

describe("runInvestigation", () => {
  test("runs tools and returns the submitted report", async () => {
    const { llm, requests } = scriptedLlm([calls(call("c1", "echo", { text: "hi" })), calls(call("c2", "submit_report", report))]);
    const result = await runInvestigation({ llm, tools: [echo], systemPrompt: "sys", userContent: "ticket" });

    expect(result.stopReason).toBe("submitted");
    expect(result.report).toEqual(report);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ name: "echo", input: { text: "hi" }, isError: false });
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10 });
    expect(requests[0]?.messages.slice(0, 2)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "ticket" },
    ]);
    expect(requests[0]?.tools.map((t) => t.function.name)).toEqual(["echo", "submit_report"]);
    expect(toolMessages(requests[1]!.messages)).toEqual([
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ echoed: "hi" }, null, 2) },
    ]);
  });

  test("turns bad arguments into tool errors and keeps going", async () => {
    const ping = defineTool({ name: "ping", description: "Ping", input: z.object({}), run: async () => "pong" });
    const { llm, requests } = scriptedLlm([
      calls(call("c1", "echo", { text: 5 }), call("c2", "echo", "{not json"), call("c3", "ping", "")),
      calls(call("c4", "submit_report", report)),
    ]);
    const result = await runInvestigation({ llm, tools: [echo, ping], systemPrompt: "s", userContent: "t" });

    expect(result.stopReason).toBe("submitted");
    expect(result.toolCalls.map((r) => r.isError)).toEqual([true, true, false]);
    const contents = toolMessages(requests[1]!.messages).map((m) => m.content);
    expect(contents[0]).toStartWith("Error: Invalid arguments");
    expect(contents[1]).toContain("not valid JSON");
    expect(contents[2]).toBe("pong");
  });

  test("reports unknown tools back to the model", async () => {
    const { llm, requests } = scriptedLlm([calls(call("c1", "rm_rf", {})), calls(call("c2", "submit_report", report))]);
    await runInvestigation({ llm, tools: [echo], systemPrompt: "s", userContent: "t" });
    expect(toolMessages(requests[1]!.messages)[0]?.content).toContain('unknown tool "rm_rf"');
  });

  test("redacts thrown tool errors", async () => {
    const failing = defineTool({
      name: "db",
      description: "DB",
      input: z.object({}),
      run: async () => {
        throw new Error("connect failed postgres://app:hunter2@db:5432/app");
      },
    });
    const { llm, requests } = scriptedLlm([calls(call("c1", "db", {})), calls(call("c2", "submit_report", report))]);
    const result = await runInvestigation({ llm, tools: [failing], systemPrompt: "s", userContent: "t", redact: createRedactor([]) });

    const content = toolMessages(requests[1]!.messages)[0]?.content ?? "";
    expect(content).toContain("postgres://app:[REDACTED]@db");
    expect(content).not.toContain("hunter2");
    expect(result.toolCalls[0]?.isError).toBe(true);
    expect(result.toolCalls[0]?.output).not.toContain("hunter2");
  });

  test("redacts and truncates large tool outputs", async () => {
    const noisy = defineTool({
      name: "noisy",
      description: "Noisy",
      input: z.object({}),
      run: async () => `leaked-secret-123 ${"x".repeat(50_000)}`,
    });
    const { llm, requests } = scriptedLlm([calls(call("c1", "noisy", {})), calls(call("c2", "submit_report", report))]);
    await runInvestigation({
      llm,
      tools: [noisy],
      systemPrompt: "s",
      userContent: "t",
      redact: createRedactor(["leaked-secret-123"]),
      maxOutputBytes: 1_000,
    });
    const content = toolMessages(requests[1]!.messages)[0]?.content ?? "";
    expect(content).not.toContain("leaked-secret-123");
    expect(content).toContain("[truncated:");
    expect(new TextEncoder().encode(content).length).toBeLessThan(1_100);
  });

  test("rejects an invalid report and accepts the corrected one", async () => {
    const tooMany = { ...report, hypotheses: [...report.hypotheses, ...report.hypotheses, ...report.hypotheses] };
    const { llm, requests } = scriptedLlm([calls(call("c1", "submit_report", tooMany)), calls(call("c2", "submit_report", report))]);
    const result = await runInvestigation({ llm, tools: [], systemPrompt: "s", userContent: "t" });
    expect(result.stopReason).toBe("submitted");
    expect(toolMessages(requests[1]!.messages)[0]?.content).toStartWith("Error:");
  });

  test("on the tool-call cap, blocks extra calls and asks for a final report", async () => {
    const { llm, requests } = scriptedLlm([
      calls(call("c1", "echo", { text: "a" }), call("c2", "echo", { text: "b" }), call("c3", "echo", { text: "c" })),
      calls(call("c4", "submit_report", { ...report, status: "inconclusive" })),
    ]);
    const result = await runInvestigation({ llm, tools: [echo], systemPrompt: "s", userContent: "t", caps: { maxToolCalls: 2 } });

    expect(result.stopReason).toBe("cap_reached");
    expect(result.report.status).toBe("inconclusive");
    expect(result.toolCalls).toHaveLength(2);
    expect(toolMessages(requests[1]!.messages)[2]?.content).toContain("budget exhausted");
    expect(requests[1]?.tools.map((t) => t.function.name)).toEqual(["submit_report"]);
    const last = requests[1]?.messages.at(-1);
    expect(last?.role).toBe("user");
  });

  test("falls back to a synthetic report if the model will not submit after the cap", async () => {
    const { llm } = scriptedLlm([calls(call("c1", "echo", { text: "a" })), text("I think it's the database.")]);
    const result = await runInvestigation({ llm, tools: [echo], systemPrompt: "s", userContent: "t", caps: { maxToolCalls: 1 } });
    expect(result.stopReason).toBe("cap_reached");
    expect(result.report.status).toBe("inconclusive");
    expect(result.report.coverage.checked).toEqual(["echo"]);
  });

  test("stops on the wall-clock cap", async () => {
    let clock = 0;
    const { llm, requests } = scriptedLlm([
      calls(call("c1", "echo", { text: "a" })),
      calls(call("c2", "submit_report", report)),
    ]);
    const result = await runInvestigation({
      llm,
      tools: [echo],
      systemPrompt: "s",
      userContent: "t",
      caps: { maxWallClockMs: 2_500 },
      now: () => (clock += 1_000),
    });
    expect(result.stopReason).toBe("cap_reached");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.tools.map((t) => t.function.name)).toEqual(["submit_report"]);
  });

  test("nudges a model that stops calling tools, then gives up", async () => {
    const { llm, requests } = scriptedLlm([text("hmm"), text("still thinking"), text("done?")]);
    const result = await runInvestigation({ llm, tools: [echo], systemPrompt: "s", userContent: "t" });
    expect(result.stopReason).toBe("no_report");
    expect(result.report.status).toBe("inconclusive");
    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "user",
      content: "Continue the investigation with the tools, or call submit_report to finish.",
    });
  });

  test("calls onToolCall for every executed tool", async () => {
    const seen: string[] = [];
    const { llm } = scriptedLlm([calls(call("c1", "echo", { text: "a" })), calls(call("c2", "submit_report", report))]);
    await runInvestigation({ llm, tools: [echo], systemPrompt: "s", userContent: "t", onToolCall: (r) => seen.push(r.name) });
    expect(seen).toEqual(["echo"]);
  });
});
