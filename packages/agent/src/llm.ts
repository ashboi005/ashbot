import type { FunctionTool } from "./tool";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type AssistantMessage = { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export type Completion = {
  message: AssistantMessage;
  usage: { promptTokens: number; completionTokens: number };
};

export type LlmClient = {
  complete(req: { messages: ChatMessage[]; tools: FunctionTool[] }): Promise<Completion>;
};

export class LlmError extends Error {}

type GatewayResponse = {
  choices?: { message: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGatewayClient(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchFn;
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}): LlmClient {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 2_000;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    async complete({ messages, tools }) {
      const body = JSON.stringify({ model: opts.model, messages, tools, tool_choice: "auto" });

      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          if (attempt >= maxAttempts) throw new LlmError(`Gateway request failed: ${String(err)}`);
          await sleep(retryDelayMs * attempt);
          continue;
        }

        if (res.status === 429 || res.status >= 500) {
          const text = await res.text();
          if (attempt >= maxAttempts) throw new LlmError(`Gateway returned ${res.status}: ${text.slice(0, 500)}`);
          await sleep(retryDelayMs * attempt);
          continue;
        }
        if (!res.ok) throw new LlmError(`Gateway returned ${res.status}: ${(await res.text()).slice(0, 500)}`);

        const json = (await res.json()) as GatewayResponse;
        const choice = json.choices?.[0];
        if (!choice) throw new LlmError("Gateway response had no choices");

        const toolCalls = choice.message.tool_calls;
        return {
          message: {
            role: "assistant",
            content: choice.message.content ?? null,
            ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          usage: {
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
          },
        };
      }
    },
  };
}
