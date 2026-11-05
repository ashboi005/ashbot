import { describe, expect, test } from "bun:test";

import type { LlmClient } from "@ashbot/agent";

import { runCli, type CliDeps } from "./main";

const profiles = {
  projects: [
    {
      id: "acme",
      name: "Acme",
      runbookFile: "runbooks/acme.md",
      coolify: { baseUrl: "https://c.example", token: "coolify-secret-token", apps: [{ name: "api", uuid: "u-api" }] },
    },
  ],
};

const report = {
  title: "API crash loop",
  severity: "high",
  status: "likely",
  hypotheses: [{ claim: "Missing env var", evidence: ["snap_1"] }],
  nextSteps: ["Set the env var"],
  coverage: { checked: ["coolify"], notChecked: [] },
};

function makeDeps(overrides: Partial<CliDeps> = {}) {
  const files: Record<string, string> = {
    "/repo/projects.local.json": JSON.stringify(profiles),
    "/repo/runbooks/acme.md": "API is app `api`.",
  };
  const written: Record<string, string> = {};
  const output: string[] = [];
  const seenRequests: unknown[] = [];
  let step = 0;
  const llm: LlmClient = {
    async complete(req) {
      seenRequests.push(structuredClone(req));
      step++;
      if (step === 1) {
        return {
          message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "coolify_app_logs", arguments: '{"app":"api"}' } }] },
          usage: { promptTokens: 100, completionTokens: 10 },
        };
      }
      return {
        message: { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "submit_report", arguments: JSON.stringify(report) } }] },
        usage: { promptTokens: 200, completionTokens: 20 },
      };
    },
  };
  const deps: CliDeps = {
    env: { MERGE_GATEWAY_API_KEY: "gw-key-123456", LLM_MODEL: "zai/glm-5.3-flash" },
    cwd: "/repo",
    readText: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    },
    readBytes: async () => new Uint8Array([1, 2, 3]),
    writeText: async (path, content) => {
      written[path] = content;
    },
    out: (line) => output.push(line),
    now: () => new Date("2026-09-29T10:00:00.000Z"),
    createLlm: () => llm,
    createIntegrations: () => ({
      coolify: {
        getApplication: async () => ({}),
        getApplicationLogs: async () => "ERROR missing STRIPE_KEY token=coolify-secret-token",
        listDeployments: async () => [],
        getDeploymentLogs: async () => "",
        listEnvKeys: async () => [],
      },
    }),
    ...overrides,
  };
  return { deps, written, output, seenRequests };
}

describe("runCli", () => {
  test("runs an investigation, prints the report and writes a redacted transcript", async () => {
    const { deps, written, output, seenRequests } = makeDeps();
    const code = await runCli(["--project", "acme", "--since", "this morning", "Checkout", "is", "broken"], deps);

    expect(code).toBe(0);
    const printed = output.join("\n");
    expect(printed).toContain("→ coolify_app_logs");
    expect(printed).toContain("# API crash loop");

    const path = "/repo/.investigations/2026-09-29T10-00-00-000Z-acme.json";
    const transcript = JSON.parse(written[path] ?? "{}");
    expect(transcript.project).toBe("acme");
    expect(transcript.model).toBe("zai/glm-5.3-flash");
    expect(transcript.ticket).toEqual({ text: "Checkout is broken", startedAt: "this morning", images: 0 });
    expect(transcript.stopReason).toBe("submitted");
    expect(transcript.snapshots).toHaveLength(1);
    expect(JSON.stringify(transcript)).not.toContain("coolify-secret-token");
    expect(JSON.stringify(seenRequests)).not.toContain("coolify-secret-token");
    expect(JSON.stringify(seenRequests)).toContain("API is app `api`.");
  });

  test("sends images as image parts", async () => {
    const { deps, seenRequests } = makeDeps();
    await runCli(["--project", "acme", "--image", "shot.png", "See screenshot"], deps);
    const first = seenRequests[0] as { messages: { role: string; content: unknown }[] };
    const user = first.messages[1]?.content as { type: string }[];
    expect(user.map((p) => p.type)).toEqual(["text", "image_url"]);
  });

  test("prints usage and returns 2 without a project or ticket", async () => {
    const { deps, output } = makeDeps();
    expect(await runCli(["just text"], deps)).toBe(2);
    expect(output.join("\n")).toContain("Usage:");
    expect(await runCli(["--project", "acme"], deps)).toBe(2);
  });

  test("returns 1 with a clear message for an unknown project", async () => {
    const { deps, output } = makeDeps();
    expect(await runCli(["--project", "nope", "text"], deps)).toBe(1);
    expect(output.join("\n")).toContain('Unknown project "nope"');
  });
});
