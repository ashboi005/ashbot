import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseProfiles, type LlmClient } from "@ashbot/agent";
import { attachment, investigation, message, project, ticket, user } from "@ashbot/db/schema";
import { createTestDb } from "@ashbot/db/testing";
import { createLocalStorage } from "@ashbot/integrations/storage";

import { claimNext, processInvestigation, requeueStale, type WorkerDeps } from "./worker";

const report = {
  title: "Payment webhook failing",
  severity: "high",
  status: "likely",
  hypotheses: [
    { claim: "Stripe secret rotated", evidence: ["snap_1"] },
    { claim: "Webhook route 500s", evidence: ["ERROR 500 /webhooks/stripe"] },
  ],
  nextSteps: ["Check the Stripe key"],
  coverage: { checked: ["coolify"], notChecked: ["aws"] },
};

async function world(opts: { llm?: LlmClient; profiles?: unknown } = {}) {
  const db = await createTestDb();
  const storage = createLocalStorage(await mkdtemp(join(tmpdir(), "ashbot-worker-")));
  await db.insert(user).values({ id: "u1", name: "Priya", email: "priya@acme.com", role: "user" });
  const [p] = await db.insert(project).values({ slug: "acme", name: "Acme Portal", runbook: "API is app `api`." }).returning();
  const [t] = await db.insert(ticket).values({ projectId: p!.id, authorId: "u1", title: "Payments failing", status: "investigating" }).returning();
  const [m] = await db.insert(message).values({ ticketId: t!.id, authorId: "u1", kind: "client", body: "Payments are failing since 9am" }).returning();
  await db.insert(message).values({ ticketId: t!.id, authorId: null, kind: "system", body: "Thanks — I'm looking into it." });
  await storage.put("uploads/u1/a.png", new Uint8Array([1, 2, 3]), "image/png");
  await db.insert(attachment).values([
    { uploaderId: "u1", messageId: m!.id, kind: "image", storageKey: "uploads/u1/a.png", mimeType: "image/png", size: 3 },
    { uploaderId: "u1", messageId: m!.id, kind: "audio", storageKey: "uploads/u1/v.webm", mimeType: "audio/webm", size: 3, transcript: "payment fail ho raha hai", transcriptEnglish: "Payments are failing." },
  ]);
  const [inv] = await db.insert(investigation).values({ ticketId: t!.id }).returning();

  const requests: unknown[] = [];
  const notifications: { content?: string; embeds?: unknown[] }[] = [];
  let step = 0;
  const llm: LlmClient = opts.llm ?? {
    async complete(req) {
      requests.push(structuredClone(req));
      step++;
      if (step === 1) {
        return { message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "coolify_app_logs", arguments: '{"app":"api"}' } }] }, usage: { promptTokens: 10, completionTokens: 2 } };
      }
      return { message: { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "submit_report", arguments: JSON.stringify(report) } }] }, usage: { promptTokens: 20, completionTokens: 4 } };
    },
  };
  const deps: WorkerDeps = {
    db,
    storage,
    llm,
    model: "zai/glm-5.3-flash",
    secrets: ["gw-key-123456"],
    loadProfiles: async () =>
      parseProfiles(opts.profiles ?? { projects: [{ id: "acme", name: "Acme", coolify: { baseUrl: "https://c.example", token: "coolify-secret-xyz", apps: [{ name: "api", uuid: "u-api" }] } }] }),
    createIntegrations: () => ({
      coolify: {
        getApplication: async () => ({}),
        getApplicationLogs: async () => "ERROR stripe signature mismatch token=coolify-secret-xyz",
        listDeployments: async () => [],
        getDeploymentLogs: async () => "",
        listEnvKeys: async () => [],
      },
    }),
    notify: async (msg) => {
      notifications.push(msg);
    },
    adminUrl: (id) => `http://localhost:3001/admin/tickets/${id}`,
  };
  return { db, deps, ticketId: t!.id, investigationId: inv!.id, requests, notifications };
}

describe("queue", () => {
  test("claims the oldest queued investigation once", async () => {
    const { db, investigationId } = await world();
    const claimed = await claimNext(db);
    expect(claimed?.id).toBe(investigationId);
    expect(claimed?.status).toBe("running");
    expect(claimed?.startedAt).toBeInstanceOf(Date);
    expect(await claimNext(db)).toBeNull();
  });

  test("requeues investigations stuck in running", async () => {
    const { db, investigationId } = await world();
    await db.update(investigation).set({ status: "running", startedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(investigation.id, investigationId));
    expect(await requeueStale(db, 15 * 60 * 1000)).toBe(1);
    const [row] = await db.select().from(investigation).where(eq(investigation.id, investigationId));
    expect(row?.status).toBe("queued");
  });
});

describe("processInvestigation", () => {
  test("runs the harness on the thread, saves the report, marks the ticket reported and notifies Discord", async () => {
    const { db, deps, ticketId, requests, notifications } = await world();
    const claimed = (await claimNext(db))!;
    await processInvestigation(deps, claimed);

    const [inv] = await db.select().from(investigation).where(eq(investigation.id, claimed.id));
    expect(inv?.status).toBe("done");
    expect(inv?.model).toBe("zai/glm-5.3-flash");
    expect(inv?.stopReason).toBe("submitted");
    expect((inv?.report as { title: string }).title).toBe("Payment webhook failing");
    expect((inv?.toolCalls as unknown[]).length).toBe(1);
    expect((inv?.snapshots as unknown[]).length).toBe(1);
    expect(JSON.stringify(inv)).not.toContain("coolify-secret-xyz");
    expect(inv?.finishedAt).toBeInstanceOf(Date);

    const [t] = await db.select().from(ticket).where(eq(ticket.id, ticketId));
    expect(t?.status).toBe("reported");

    const first = requests[0] as { messages: { role: string; content: unknown }[] };
    expect(first.messages[0]?.content).toContain("API is app `api`.");
    const user = first.messages[1]?.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(user[0]?.text).toContain("Payments are failing since 9am");
    expect(user[0]?.text).toContain("Payments are failing.");
    expect(user[0]?.text).not.toContain("looking into it");
    expect(user[1]?.image_url?.url).toBe("data:image/png;base64,AQID");

    expect(notifications).toHaveLength(1);
    const embed = (notifications[0]?.embeds?.[0] ?? {}) as { title?: string; description?: string; url?: string };
    expect(embed.title).toContain("Payment webhook failing");
    expect(embed.description).toContain("Stripe secret rotated");
    expect(embed.description).toContain("Webhook route 500s");
    expect(embed.url).toBe(`http://localhost:3001/admin/tickets/${ticketId}`);
  });

  test("fails clearly when the project has no profile in the projects file", async () => {
    const { db, deps, ticketId, notifications } = await world({ profiles: { projects: [{ id: "someone-else", name: "X" }] } });
    const claimed = (await claimNext(db))!;
    await processInvestigation(deps, claimed);
    const [inv] = await db.select().from(investigation).where(eq(investigation.id, claimed.id));
    expect(inv?.status).toBe("failed");
    expect(inv?.error).toContain('No profile for project "acme"');
    const [t] = await db.select().from(ticket).where(eq(ticket.id, ticketId));
    expect(t?.status).toBe("received");
    expect(notifications[0]?.content).toContain("failed");
  });

  test("records model errors as a failed investigation", async () => {
    const { db, deps } = await world({ llm: { complete: async () => { throw new Error("Gateway returned 401: bad key gw-key-123456"); } } });
    const claimed = (await claimNext(db))!;
    await processInvestigation(deps, claimed);
    const [inv] = await db.select().from(investigation).where(eq(investigation.id, claimed.id));
    expect(inv?.status).toBe("failed");
    expect(inv?.error).toContain("Gateway returned 401");
    expect(inv?.error).not.toContain("gw-key-123456");
  });

  test("a Discord outage does not fail the investigation", async () => {
    const { db, deps } = await world();
    deps.notify = async () => {
      throw new Error("discord down");
    };
    const claimed = (await claimNext(db))!;
    await processInvestigation(deps, claimed);
    const [inv] = await db.select().from(investigation).where(eq(investigation.id, claimed.id));
    expect(inv?.status).toBe("done");
  });
});
