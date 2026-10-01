import { expect, test } from "bun:test";

import { loadWorkerConfig } from "./config";

const base = { DATABASE_URL: "postgres://a:b@localhost:5432/x", MERGE_GATEWAY_API_KEY: "k", LLM_MODEL: "zai/glm-5.3-flash", CORS_ORIGIN: "http://localhost:3001" };

test("applies defaults", () => {
  const config = loadWorkerConfig(base, "/repo");
  expect(config.projectsFile).toBe("/repo/projects.local.json");
  expect(config.gatewayBaseUrl).toBe("https://gateway.merge.dev/v1");
  expect(config.discordWebhookUrl).toBeUndefined();
  expect(config.adminUrl("t1")).toBe("http://localhost:3001/admin/tickets/t1");
  expect(config.pollMs).toBe(3000);
});

test("resolves a relative projects file against the repo root", () => {
  expect(loadWorkerConfig({ ...base, PROJECTS_FILE: "config/projects.json" }, "/repo").projectsFile).toBe("/repo/config/projects.json");
});

test("names what is missing", () => {
  expect(() => loadWorkerConfig({ DATABASE_URL: base.DATABASE_URL }, "/repo")).toThrow("MERGE_GATEWAY_API_KEY");
});
