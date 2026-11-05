import { createGatewayClient, createProjectIntegrations, parseProfiles } from "@ashbot/agent";
import { createDb } from "@ashbot/db";
import { sendDiscordMessage } from "@ashbot/integrations/discord";
import { storageFromEnv, type StorageEnv } from "@ashbot/integrations/storage";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadWorkerConfig } from "./config";
import { claimNext, processInvestigation, requeueStale, type WorkerDeps } from "./worker";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const STALE_AFTER_MS = 15 * 60 * 1000;

const config = loadWorkerConfig(process.env, REPO_ROOT);
const db = createDb({ DATABASE_URL: config.databaseUrl });

const deps: WorkerDeps = {
  db,
  storage: storageFromEnv(process.env as StorageEnv, resolve(REPO_ROOT, ".uploads")),
  llm: createGatewayClient({ baseUrl: config.gatewayBaseUrl, apiKey: config.gatewayApiKey, model: config.model }),
  model: config.model,
  secrets: [config.gatewayApiKey],
  loadProfiles: async () => {
    const profiles = parseProfiles(JSON.parse(await readFile(config.projectsFile, "utf8")));
    // Inline runbookFile contents so the harness gets plain text.
    return Promise.all(
      profiles.map(async (p) => (p.runbookFile ? { ...p, runbook: await readFile(resolve(dirname(config.projectsFile), p.runbookFile), "utf8") } : p)),
    );
  },
  createIntegrations: createProjectIntegrations,
  notify: config.discordWebhookUrl ? (msg) => sendDiscordMessage({ webhookUrl: config.discordWebhookUrl! }, msg) : undefined,
  adminUrl: config.adminUrl,
};

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`Worker: ${signal} received, finishing the current investigation…`);
    stopping = true;
  });
}

const requeued = await requeueStale(db, STALE_AFTER_MS);
if (requeued > 0) console.log(`Worker: requeued ${requeued} investigation(s) left running by a previous worker.`);
console.log(`Worker: polling every ${config.pollMs}ms with ${config.model}. Projects file: ${config.projectsFile}`);
if (!config.discordWebhookUrl) console.log("Worker: DISCORD_WEBHOOK_URL is not set, so reports are only visible in the admin panel.");

while (!stopping) {
  const next = await claimNext(db).catch((err) => {
    console.error("Worker: could not reach the database", err);
    return null;
  });
  if (!next) {
    await Bun.sleep(config.pollMs);
    continue;
  }
  console.log(`Worker: investigating ticket ${next.ticketId} (${next.id})`);
  await processInvestigation(deps, next);
  console.log(`Worker: finished ${next.id}`);
}
process.exit(0);
