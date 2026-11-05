import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createGatewayClient, createProjectIntegrations } from "@ashbot/agent";

import { runCli } from "./main";

const code = await runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  readText: (path) => readFile(path, "utf8"),
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  writeText: async (path, content) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  },
  out: (line) => console.log(line),
  now: () => new Date(),
  createLlm: (config) => createGatewayClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }),
  createIntegrations: createProjectIntegrations,
});

process.exit(code);
