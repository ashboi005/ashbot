import { z } from "zod";

import type { Caps } from "@ashbot/agent";

const envSchema = z.object({
  MERGE_GATEWAY_API_KEY: z.string().min(1),
  MERGE_GATEWAY_BASE_URL: z.url().default("https://gateway.merge.dev/v1"),
  LLM_MODEL: z.string().min(1),
  INVESTIGATION_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(40),
  INVESTIGATION_MAX_MINUTES: z.coerce.number().positive().default(10),
  INVESTIGATION_MAX_TOKENS: z.coerce.number().int().positive().default(1_000_000),
});

export type CliConfig = { apiKey: string; baseUrl: string; model: string; caps: Caps };

export function loadConfig(env: Record<string, string | undefined>): CliConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment (see .env.example):\n${z.prettifyError(result.error)}`);
  const e = result.data;
  return {
    apiKey: e.MERGE_GATEWAY_API_KEY,
    baseUrl: e.MERGE_GATEWAY_BASE_URL,
    model: e.LLM_MODEL,
    caps: {
      maxToolCalls: e.INVESTIGATION_MAX_TOOL_CALLS,
      maxWallClockMs: e.INVESTIGATION_MAX_MINUTES * 60_000,
      maxTokens: e.INVESTIGATION_MAX_TOKENS,
    },
  };
}
