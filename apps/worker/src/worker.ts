import {
  buildProjectTools,
  buildSystemPrompt,
  buildTicketContent,
  createRedactor,
  createSnapshotStore,
  runInvestigation,
  secretsOf,
  type Caps,
  type LlmClient,
  type ProjectProfile,
  type Report,
  type ToolDeps,
} from "@ashbot/agent";
import type { Database } from "@ashbot/db";
import { attachment, investigation, message, project, ticket, user } from "@ashbot/db/schema";
import type { DiscordEmbed } from "@ashbot/integrations/discord";
import type { Storage } from "@ashbot/integrations/storage";
import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";

export type WorkerDeps = {
  db: Database;
  storage: Storage;
  llm: LlmClient;
  model: string;
  // Extra values to mask everywhere (e.g. the gateway key).
  secrets: string[];
  loadProfiles: () => Promise<ProjectProfile[]>;
  createIntegrations: (profile: ProjectProfile) => Omit<ToolDeps, "snapshots">;
  notify?: (message: { content?: string; embeds?: DiscordEmbed[] }) => Promise<void>;
  adminUrl: (ticketId: string) => string;
  caps?: Partial<Caps>;
};

type InvestigationRow = typeof investigation.$inferSelect;

const MAX_IMAGES = 5;
const SEVERITY_COLORS: Record<Report["severity"], number> = { critical: 0xb42318, high: 0xc2410c, medium: 0xa16207, low: 0x475467 };

export async function claimNext(db: Database): Promise<InvestigationRow | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select()
      .from(investigation)
      .where(eq(investigation.status, "queued"))
      .orderBy(asc(investigation.queuedAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [claimed] = await tx
      .update(investigation)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(investigation.id, next.id))
      .returning();
    return claimed ?? null;
  });
}

// A worker that died mid-run leaves rows in "running"; put them back in the queue.
export async function requeueStale(db: Database, olderThanMs: number): Promise<number> {
  const rows = await db
    .update(investigation)
    .set({ status: "queued", startedAt: null })
    .where(and(eq(investigation.status, "running"), lt(investigation.startedAt, new Date(Date.now() - olderThanMs))))
    .returning();
  return rows.length;
}

async function buildInput(deps: WorkerDeps, ticketId: string) {
  const [row] = await deps.db
    .select({ ticket, project, authorName: user.name })
    .from(ticket)
    .innerJoin(project, eq(project.id, ticket.projectId))
    .innerJoin(user, eq(user.id, ticket.authorId))
    .where(eq(ticket.id, ticketId));
  if (!row) throw new Error(`Ticket ${ticketId} no longer exists`);

  const messages = await deps.db
    .select({ message, authorName: user.name })
    .from(message)
    .leftJoin(user, eq(user.id, message.authorId))
    .where(and(eq(message.ticketId, ticketId), ne(message.kind, "system")))
    .orderBy(asc(message.createdAt));
  const ids = messages.map((m) => m.message.id);
  const attachments = ids.length > 0 ? await deps.db.select().from(attachment).where(inArray(attachment.messageId, ids)).orderBy(asc(attachment.createdAt)) : [];

  const lines = ["Conversation so far (oldest first):"];
  for (const { message: m, authorName } of messages) {
    const who = m.kind === "admin" ? `Engineer (${authorName ?? "admin"})` : `Client (${authorName ?? "client"})`;
    lines.push(`[${m.createdAt.toISOString()}] ${who}: ${m.body || "(no text)"}`);
    const own = attachments.filter((a) => a.messageId === m.id);
    for (const a of own.filter((a) => a.kind === "audio")) {
      lines.push(`  Voice note${a.transcriptEnglish ? ` (English): ${a.transcriptEnglish}` : ": (could not be transcribed)"}`);
    }
    const images = own.filter((a) => a.kind === "image").length;
    if (images > 0) lines.push(`  Attached ${images} image(s).`);
  }

  const imageRows = attachments.filter((a) => a.kind === "image").slice(-MAX_IMAGES);
  const images = await Promise.all(
    imageRows.map(async (a) => `data:${a.mimeType};base64,${Buffer.from(await deps.storage.get(a.storageKey)).toString("base64")}`),
  );

  return {
    project: row.project,
    authorName: row.authorName,
    content: buildTicketContent({ text: lines.join("\n"), reportedAt: row.ticket.createdAt.toISOString(), images }),
  };
}

async function notifySafely(deps: WorkerDeps, msg: { content?: string; embeds?: DiscordEmbed[] }) {
  try {
    await deps.notify?.(msg);
  } catch (err) {
    console.error("Discord notification failed", err);
  }
}

function reportEmbed(report: Report, meta: { projectName: string; url: string }): DiscordEmbed {
  const hypotheses = report.hypotheses.length
    ? report.hypotheses.map((h) => `• **${h.claim}**\n  evidence: ${h.evidence.slice(0, 3).join(", ")}`).join("\n")
    : "_No hypothesis: inconclusive._";
  return {
    title: `[${report.severity.toUpperCase()}] ${report.title}`.slice(0, 256),
    url: meta.url,
    color: SEVERITY_COLORS[report.severity],
    description: hypotheses.slice(0, 4000),
    fields: [
      { name: "Project", value: meta.projectName, inline: true },
      { name: "Confidence", value: report.status, inline: true },
      ...(report.nextSteps[0] ? [{ name: "Next step", value: report.nextSteps[0].slice(0, 1000) }] : []),
    ],
  };
}

export async function processInvestigation(deps: WorkerDeps, row: InvestigationRow): Promise<void> {
  let redact = createRedactor(deps.secrets);
  let projectName = "unknown project";
  try {
    const input = await buildInput(deps, row.ticketId);
    projectName = input.project.name;
    const profiles = await deps.loadProfiles();
    const profile = profiles.find((p) => p.id === input.project.slug);
    if (!profile) {
      throw new Error(`No profile for project "${input.project.slug}" in the projects file. Add one with id "${input.project.slug}".`);
    }
    redact = createRedactor([...secretsOf(profile), ...deps.secrets]);

    const snapshots = createSnapshotStore({ redact });
    const result = await runInvestigation({
      llm: deps.llm,
      tools: buildProjectTools(profile, { ...deps.createIntegrations(profile), snapshots }),
      systemPrompt: buildSystemPrompt({ projectName: input.project.name, runbook: input.project.runbook || profile.runbook }),
      userContent: input.content,
      caps: deps.caps,
      redact,
    });

    await deps.db
      .update(investigation)
      .set({
        status: "done",
        model: deps.model,
        stopReason: result.stopReason,
        report: result.report,
        toolCalls: result.toolCalls,
        snapshots: snapshots.all(),
        usage: result.usage,
        finishedAt: new Date(),
      })
      .where(eq(investigation.id, row.id));
    await deps.db.update(ticket).set({ status: "reported" }).where(and(eq(ticket.id, row.ticketId), ne(ticket.status, "resolved")));

    await notifySafely(deps, {
      content: `New report for **${input.project.name}** from ${input.authorName}`,
      embeds: [reportEmbed(result.report, { projectName: input.project.name, url: deps.adminUrl(row.ticketId) })],
    });
  } catch (err) {
    const error = redact(err instanceof Error ? err.message : String(err));
    await deps.db.update(investigation).set({ status: "failed", error, model: deps.model, finishedAt: new Date() }).where(eq(investigation.id, row.id));
    await deps.db.update(ticket).set({ status: "received" }).where(and(eq(ticket.id, row.ticketId), ne(ticket.status, "resolved")));
    await notifySafely(deps, { content: `Investigation failed for **${projectName}**: ${error.slice(0, 1500)}\n${deps.adminUrl(row.ticketId)}` });
  }
}
