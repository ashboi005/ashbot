import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  buildProjectTools,
  buildSystemPrompt,
  buildTicketContent,
  createRedactor,
  createSnapshotStore,
  findProject,
  parseProfiles,
  renderReportMarkdown,
  runInvestigation,
  secretsOf,
  type LlmClient,
  type ProjectProfile,
  type ToolDeps,
} from "@ashbot/agent";

import { loadConfig, type CliConfig } from "./config";
import { imageToDataUrl } from "./images";

export type Integrations = Omit<ToolDeps, "snapshots">;

export type CliDeps = {
  env: Record<string, string | undefined>;
  cwd: string;
  readText: (path: string) => Promise<string>;
  readBytes: (path: string) => Promise<Uint8Array>;
  writeText: (path: string, content: string) => Promise<void>;
  out: (line: string) => void;
  now: () => Date;
  createLlm: (config: CliConfig) => LlmClient;
  createIntegrations: (profile: ProjectProfile) => Integrations;
};

const USAGE = `Usage: bun run investigate --project <id> [--since "<when it started>"] [--image <path>]... [--profiles <file>] "<ticket text>"`;

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: "string" },
      since: { type: "string" },
      image: { type: "string", multiple: true },
      profiles: { type: "string", default: "projects.local.json" },
    },
  });
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli(argv);
  } catch (err) {
    deps.out(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }

  const { project: projectId, since, image = [], profiles = "projects.local.json" } = parsed.values;
  const ticketText = parsed.positionals.join(" ").trim();
  if (!projectId || !ticketText) {
    deps.out(USAGE);
    return 2;
  }

  try {
    const config = loadConfig(deps.env);
    const profilesPath = resolve(deps.cwd, profiles);
    const project = findProject(parseProfiles(JSON.parse(await deps.readText(profilesPath))), projectId);
    const runbook = project.runbookFile ? await deps.readText(resolve(dirname(profilesPath), project.runbookFile)) : project.runbook;

    const redact = createRedactor([...secretsOf(project), config.apiKey]);
    const snapshots = createSnapshotStore({ redact, now: deps.now });
    const tools = buildProjectTools(project, { ...deps.createIntegrations(project), snapshots });
    const images = await Promise.all(image.map(async (path) => imageToDataUrl(path, await deps.readBytes(resolve(deps.cwd, path)))));
    const startedAt = deps.now();

    deps.out(`Investigating "${project.name}" with ${tools.length} tools on ${config.model}…`);
    const result = await runInvestigation({
      llm: deps.createLlm(config),
      tools,
      systemPrompt: buildSystemPrompt({ projectName: project.name, runbook }),
      userContent: buildTicketContent({ text: ticketText, reportedAt: startedAt.toISOString(), startedAt: since, images }),
      caps: config.caps,
      redact,
      onToolCall: (r) => deps.out(`  ${r.isError ? "✗" : "→"} ${r.name} (${r.durationMs}ms)${r.isError ? ` ${r.output.split("\n")[0]}` : ""}`),
    });

    const transcriptPath = resolve(deps.cwd, ".investigations", `${startedAt.toISOString().replace(/[:.]/g, "-")}-${project.id}.json`);
    const transcript = {
      project: project.id,
      model: config.model,
      startedAt: startedAt.toISOString(),
      ticket: { text: ticketText, startedAt: since, images: images.length },
      stopReason: result.stopReason,
      usage: result.usage,
      report: result.report,
      toolCalls: result.toolCalls,
      snapshots: snapshots.all(),
    };
    await deps.writeText(transcriptPath, JSON.stringify(transcript, (_key, value) => (typeof value === "string" ? redact(value) : value), 2));

    deps.out("");
    deps.out(renderReportMarkdown(result.report, { project: project.id, stopReason: result.stopReason }));
    deps.out("");
    deps.out(`Tokens: ${result.usage.promptTokens} in / ${result.usage.completionTokens} out · Transcript: ${transcriptPath}`);
    return 0;
  } catch (err) {
    deps.out(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
