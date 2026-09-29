import { z } from "zod";

export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  run: (input: z.infer<S>) => Promise<unknown>;
};

export type AnyTool = Tool<any>;

export type FunctionTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

export function toFunctionSpec(tool: AnyTool): FunctionTool {
  const parameters = { ...(z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>) };
  delete parameters.$schema;
  return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
}

export function parseArgs<S extends z.ZodType>(
  raw: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, error: "Arguments were not valid JSON. Send a JSON object matching the tool's schema." };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, error: `Invalid arguments:\n${z.prettifyError(result.error)}` };
  return { ok: true, value: result.data };
}
