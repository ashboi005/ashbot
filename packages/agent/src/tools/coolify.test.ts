import { describe, expect, test } from "bun:test";

import type { CoolifyClient } from "@ashbot/integrations/coolify";

import { createSnapshotStore } from "../snapshots";
import type { AnyTool } from "../tool";
import { coolifyTools } from "./coolify";

const cfg = { baseUrl: "https://c.example", token: "t", apps: [{ name: "api", uuid: "u-api" }, { name: "web", uuid: "u-web" }] };

function fakeClient(overrides: Partial<CoolifyClient> = {}): CoolifyClient {
  return {
    getApplication: async (uuid) => ({
      name: `app ${uuid}`,
      status: "running:healthy",
      fqdn: "https://api.acme.example",
      git_commit_sha: "abc123",
      git_branch: "main",
      custom_labels: "traefik.secret=1",
    }),
    getApplicationLogs: async () => "2026-09-29T10:00:00Z ERROR boom",
    listDeployments: async () => [{ deployment_uuid: "d1", status: "finished", commit: "abc123", logs: "huge" }],
    getDeploymentLogs: async () => "Building...\nDone",
    listEnvKeys: async () => ["DATABASE_URL", "NODE_ENV"],
    ...overrides,
  };
}

const byName = (tools: AnyTool[], name: string) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing ${name}`);
  return tool;
};

describe("coolifyTools", () => {
  test("only accepts configured app names", () => {
    const tools = coolifyTools(cfg, fakeClient(), createSnapshotStore({ redact: (s) => s }));
    const logs = byName(tools, "coolify_app_logs");
    expect(logs.input.safeParse({ app: "api" }).success).toBe(true);
    expect(logs.input.safeParse({ app: "database" }).success).toBe(false);
  });

  test("app status returns selected fields for all apps by default", async () => {
    const tools = coolifyTools(cfg, fakeClient(), createSnapshotStore({ redact: (s) => s }));
    const result = (await byName(tools, "coolify_app_status").run({})) as Record<string, unknown>[];
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      app: "api",
      name: "app u-api",
      status: "running:healthy",
      fqdn: "https://api.acme.example",
      git_commit_sha: "abc123",
      git_branch: "main",
    });
  });

  test("app logs are saved as a snapshot and returned with the snapshot id", async () => {
    const snapshots = createSnapshotStore({ redact: (s) => s });
    const big = "x".repeat(200_000);
    const tools = coolifyTools(cfg, fakeClient({ getApplicationLogs: async () => big }), snapshots);
    const result = (await byName(tools, "coolify_app_logs").run({ app: "api", lines: 200 })) as { snapshot: string; content: string };

    expect(result.snapshot).toBe("snap_1");
    expect(result.content).toBe(big);
    expect(snapshots.all()[0]).toMatchObject({ source: "coolify", query: "app logs api (200 lines)", content: big });
  });

  test("deployments omit bulky fields like logs", async () => {
    const tools = coolifyTools(cfg, fakeClient(), createSnapshotStore({ redact: (s) => s }));
    const result = (await byName(tools, "coolify_deployments").run({ app: "api", take: 5 })) as Record<string, unknown>[];
    expect(result).toEqual([{ deployment_uuid: "d1", status: "finished", commit: "abc123" }]);
  });

  test("deployment logs refuse a deployment that isn't this app's", async () => {
    const tools = coolifyTools(cfg, fakeClient(), createSnapshotStore({ redact: (s) => s }));
    await expect(byName(tools, "coolify_deployment_logs").run({ app: "api", deploymentUuid: "other" })).rejects.toThrow(
      'Deployment "other" is not one of the recent deployments of app "api"',
    );
  });

  test("deployment logs are snapshotted", async () => {
    const snapshots = createSnapshotStore({ redact: (s) => s });
    const tools = coolifyTools(cfg, fakeClient(), snapshots);
    const result = (await byName(tools, "coolify_deployment_logs").run({ app: "api", deploymentUuid: "d1" })) as { snapshot: string };
    expect(result.snapshot).toBe("snap_1");
    expect(snapshots.all()[0]?.content).toBe("Building...\nDone");
  });

  test("env names returns names only", async () => {
    const tools = coolifyTools(cfg, fakeClient(), createSnapshotStore({ redact: (s) => s }));
    expect(await byName(tools, "coolify_env_names").run({ app: "web" })).toEqual({ app: "web", names: ["DATABASE_URL", "NODE_ENV"] });
  });
});
