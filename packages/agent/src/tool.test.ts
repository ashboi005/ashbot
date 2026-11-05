import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { defineTool, parseArgs, toFunctionSpec } from "./tool";

const logs = defineTool({
  name: "app_logs",
  description: "Fetch logs",
  input: z.object({
    app: z.enum(["api", "web"]),
    lines: z.int().min(1).max(500).default(100),
  }),
  run: async ({ app, lines }) => `${app}:${lines}`,
});

describe("toFunctionSpec", () => {
  test("produces an OpenAI function spec without $schema", () => {
    const spec = toFunctionSpec(logs);
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("app_logs");
    expect(spec.function.description).toBe("Fetch logs");
    expect(spec.function.parameters.$schema).toBeUndefined();
    expect(spec.function.parameters.type).toBe("object");
  });

  test("treats defaulted fields as optional for the model", () => {
    const spec = toFunctionSpec(logs);
    expect(spec.function.parameters.required).toEqual(["app"]);
  });
});

describe("parseArgs", () => {
  test("parses valid JSON and applies defaults", () => {
    expect(parseArgs('{"app":"api"}', logs.input)).toEqual({ ok: true, value: { app: "api", lines: 100 } });
  });

  test("treats an empty string as an empty object", () => {
    const empty = z.object({});
    expect(parseArgs("", empty)).toEqual({ ok: true, value: {} });
    expect(parseArgs("   ", empty)).toEqual({ ok: true, value: {} });
  });

  test("reports malformed JSON", () => {
    const result = parseArgs("{not json", logs.input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not valid JSON");
  });

  test("reports schema violations readably", () => {
    const result = parseArgs('{"app":"db"}', logs.input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("app");
  });
});
