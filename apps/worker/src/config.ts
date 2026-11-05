import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MERGE_GATEWAY_API_KEY: z.string().min(1),
  MERGE_GATEWAY_BASE_URL: z.url().default("https://api-gateway.merge.dev/v1"),
  LLM_MODEL: z.string().min(1),
  CORS_ORIGIN: z.url().default("http://localhost:3001"),
  PROJECTS_FILE: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.url().optional().or(z.literal("").transform(() => undefined)),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(3000),
});

export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;

export function loadWorkerConfig(env: Record<string, string | undefined>, repoRoot: string) {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid worker environment (set these in apps/server/.env):\n${z.prettifyError(result.error)}`);
  const e = result.data;
  const webOrigin = e.CORS_ORIGIN.replace(/\/+$/, "");
  return {
    databaseUrl: e.DATABASE_URL,
    gatewayApiKey: e.MERGE_GATEWAY_API_KEY,
    gatewayBaseUrl: e.MERGE_GATEWAY_BASE_URL,
    model: e.LLM_MODEL,
    projectsFile: resolve(repoRoot, e.PROJECTS_FILE || "projects.local.json"),
    discordWebhookUrl: e.DISCORD_WEBHOOK_URL,
    pollMs: e.WORKER_POLL_MS,
    adminUrl: (ticketId: string) => `${webOrigin}/admin/tickets/${ticketId}`,
  };
}
