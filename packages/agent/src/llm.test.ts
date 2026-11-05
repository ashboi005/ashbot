import { describe, expect, test } from "bun:test";

import { createGatewayClient, LlmError, type FetchFn } from "./llm";
import type { FunctionTool } from "./tool";

const tools: FunctionTool[] = [
  { type: "function", function: { name: "ping", description: "Ping", parameters: { type: "object", properties: {} } } },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const okBody = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "ping", arguments: "{}" } }],
      },
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 3 },
};

describe("createGatewayClient", () => {
  test("posts an OpenAI-style request to the gateway and parses tool calls", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, okBody);
    };
    const client = createGatewayClient({ baseUrl: "https://api-gateway.merge.dev/v1/", apiKey: "k-123", model: "zai/glm-5.3-flash", fetch: fetchFn });

    const result = await client.complete({ messages: [{ role: "user", content: "hi" }], tools });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api-gateway.merge.dev/v1/chat/completions");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer k-123");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({ model: "zai/glm-5.3-flash", messages: [{ role: "user", content: "hi" }], tools, tool_choice: "auto" });
    expect(result.message.tool_calls?.[0]?.function.name).toBe("ping");
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });

  test("retries 429 and 5xx, then succeeds", async () => {
    const statuses = [429, 503];
    let count = 0;
    const fetchFn: FetchFn = async () => {
      count++;
      const status = statuses.shift();
      return status ? jsonResponse(status, { error: "busy" }) : jsonResponse(200, okBody);
    };
    const client = createGatewayClient({ baseUrl: "https://g/v1", apiKey: "k", model: "m", fetch: fetchFn, retryDelayMs: 0 });
    await client.complete({ messages: [{ role: "user", content: "hi" }], tools });
    expect(count).toBe(3);
  });

  test("does not retry 400 errors", async () => {
    let count = 0;
    const fetchFn: FetchFn = async () => {
      count++;
      return jsonResponse(400, { error: "bad model" });
    };
    const client = createGatewayClient({ baseUrl: "https://g/v1", apiKey: "k", model: "m", fetch: fetchFn, retryDelayMs: 0 });
    await expect(client.complete({ messages: [{ role: "user", content: "hi" }], tools })).rejects.toThrow(LlmError);
    expect(count).toBe(1);
  });

  test("gives up after maxAttempts", async () => {
    let count = 0;
    const fetchFn: FetchFn = async () => {
      count++;
      return jsonResponse(500, { error: "down" });
    };
    const client = createGatewayClient({ baseUrl: "https://g/v1", apiKey: "k", model: "m", fetch: fetchFn, retryDelayMs: 0, maxAttempts: 2 });
    await expect(client.complete({ messages: [{ role: "user", content: "hi" }], tools })).rejects.toThrow("500");
    expect(count).toBe(2);
  });

  test("retries network errors", async () => {
    let count = 0;
    const fetchFn: FetchFn = async () => {
      count++;
      if (count === 1) throw new TypeError("fetch failed");
      return jsonResponse(200, okBody);
    };
    const client = createGatewayClient({ baseUrl: "https://g/v1", apiKey: "k", model: "m", fetch: fetchFn, retryDelayMs: 0 });
    await client.complete({ messages: [{ role: "user", content: "hi" }], tools });
    expect(count).toBe(2);
  });

  test("throws when the response has no choices", async () => {
    const client = createGatewayClient({ baseUrl: "https://g/v1", apiKey: "k", model: "m", fetch: async () => jsonResponse(200, { choices: [] }) });
    await expect(client.complete({ messages: [{ role: "user", content: "hi" }], tools })).rejects.toThrow("no choices");
  });
});

test("omits tools and tool_choice when there are no tools", async () => {
  let sent: Record<string, unknown> = {};
  const fetchFn: FetchFn = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return jsonResponse(200, { choices: [{ message: { role: "assistant", content: "ok" } }] });
  };
  const client = createGatewayClient({ baseUrl: "https://g/v1", apiKey: "k", model: "m", fetch: fetchFn });
  const result = await client.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });
  expect(sent).toEqual({ model: "m", messages: [{ role: "user", content: "hi" }] });
  expect(result.message.content).toBe("ok");
});
