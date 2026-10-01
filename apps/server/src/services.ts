import { cleanTranscript, createGatewayClient } from "@ashbot/agent";
import { createAuth } from "@ashbot/auth";
import { createDb } from "@ashbot/db";
import { createDeepgramClient } from "@ashbot/integrations/deepgram";
import { storageFromEnv } from "@ashbot/integrations/storage";
import { resolve } from "node:path";

import type { AppDeps } from "./app";
import { ENV } from "./env.server";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
export const storage = storageFromEnv(ENV, resolve(REPO_ROOT, ".uploads"));

const deepgram = ENV.DEEPGRAM_API_KEY ? createDeepgramClient({ apiKey: ENV.DEEPGRAM_API_KEY }) : undefined;
const cleanupModel = ENV.CLEANUP_MODEL || ENV.LLM_MODEL;
const cleanupLlm =
  ENV.MERGE_GATEWAY_API_KEY && cleanupModel
    ? createGatewayClient({ baseUrl: ENV.MERGE_GATEWAY_BASE_URL ?? "https://gateway.merge.dev/v1", apiKey: ENV.MERGE_GATEWAY_API_KEY, model: cleanupModel })
    : undefined;

export const appDeps: AppDeps = {
  db,
  auth,
  storage,
  webOrigin: ENV.CORS_ORIGIN,
  corsOrigin: ENV.CORS_ORIGIN,
  transcribe: deepgram?.transcribe,
  cleanup: cleanupLlm ? (text) => cleanTranscript(cleanupLlm, text) : undefined,
};
