import { expect, test } from "bun:test";

import { loadConfig } from "./config";

test("applies defaults", () => {
  const config = loadConfig({ MERGE_GATEWAY_API_KEY: "k", LLM_MODEL: "zai/glm-5.3-flash" });
  expect(config).toEqual({
    apiKey: "k",
    baseUrl: "https://api-gateway.merge.dev/v1",
    model: "zai/glm-5.3-flash",
    caps: { maxToolCalls: 40, maxWallClockMs: 600_000, maxTokens: 1_000_000 },
  });
});

test("reads cap overrides", () => {
  const config = loadConfig({ MERGE_GATEWAY_API_KEY: "k", LLM_MODEL: "m", INVESTIGATION_MAX_TOOL_CALLS: "10", INVESTIGATION_MAX_MINUTES: "2" });
  expect(config.caps.maxToolCalls).toBe(10);
  expect(config.caps.maxWallClockMs).toBe(120_000);
});

test("names missing variables", () => {
  expect(() => loadConfig({ LLM_MODEL: "m" })).toThrow("MERGE_GATEWAY_API_KEY");
});
