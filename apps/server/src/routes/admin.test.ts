import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { AdminTicketDetail, AdminTicketSummary, ClientDto, InviteDto, InvitePreview, Me, ProjectDto, TicketDetail } from "@ashbot/contracts";
import { invite, investigation } from "@ashbot/db/schema";

import { setup } from "../test/setup";

async function world() {
  const ctx = await setup();
  const admin = await ctx.createUser("admin", "ash@studio.com", "Ashwath");
  const client = await ctx.createUser("user", "priya@acme.com", "Priya");
  const acme = await ctx.createProject("acme", "Acme Portal");
  await ctx.addMember(client.id, acme.id);
  const ticket = (await (
    await ctx.request("/api/tickets", { method: "POST", cookie: client.cookie, json: { projectId: acme.id, body: "Checkout broken", attachmentIds: [] } })
  ).json()) as TicketDetail;
  return { ...ctx, admin, client, acme, ticket };
}

describe("admin access", () => {
  test("clients get 403 on admin routes", async () => {
    const { request, client } = await world();
    for (const path of ["/api/admin/tickets", "/api/admin/projects", "/api/admin/clients", "/api/admin/invites"]) {
      expect((await request(path, { cookie: client.cookie })).status).toBe(403);
    }
  });
});

describe("inbox and ticket detail", () => {
  test("lists tickets with client, project and investigation state", async () => {
    const { request, admin } = await world();
    const inbox = (await (await request("/api/admin/tickets", { cookie: admin.cookie })).json()) as AdminTicketSummary[];
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ title: "Checkout broken", authorName: "Priya", projectName: "Acme Portal", status: "investigating", investigationStatus: "queued", severity: null });
  });

  test("filters by status", async () => {
    const { request, admin } = await world();
    const resolved = (await (await request("/api/admin/tickets?status=resolved", { cookie: admin.cookie })).json()) as AdminTicketSummary[];
    expect(resolved).toHaveLength(0);
  });

  test("shows the report from a finished investigation, and the severity in the inbox", async () => {
    const { request, admin, ticket, db } = await world();
    const report = { title: "Pool exhausted", severity: "high", status: "likely", hypotheses: [{ claim: "DB pool", evidence: ["snap_1"] }], nextSteps: [], coverage: { checked: [], notChecked: [] } };
    await db.update(investigation).set({ status: "done", report, toolCalls: [{ name: "axiom_query", input: {}, output: "x", isError: false, durationMs: 5 }], snapshots: [] }).where(eq(investigation.ticketId, ticket.id));

    const detail = (await (await request(`/api/admin/tickets/${ticket.id}`, { cookie: admin.cookie })).json()) as AdminTicketDetail;
    expect(detail.author.email).toBe("priya@acme.com");
    expect(detail.investigations[0]?.report?.title).toBe("Pool exhausted");
    expect(detail.investigations[0]?.toolCalls[0]?.name).toBe("axiom_query");
    const inbox = (await (await request("/api/admin/tickets", { cookie: admin.cookie })).json()) as AdminTicketSummary[];
    expect(inbox[0]?.severity).toBe("high");
  });

  test("admin replies are visible to the client, reports are not", async () => {
    const { request, admin, client, ticket } = await world();
    await request(`/api/admin/tickets/${ticket.id}/messages`, { method: "POST", cookie: admin.cookie, json: { body: "Found it, fixing now." } });
    const clientView = (await (await request(`/api/tickets/${ticket.id}`, { cookie: client.cookie })).json()) as Record<string, unknown> & TicketDetail;
    expect(clientView.messages.at(-1)).toMatchObject({ kind: "admin", body: "Found it, fixing now.", authorName: "Ashwath" });
    expect(clientView.investigations).toBeUndefined();
  });

  test("re-running queues another investigation", async () => {
    const { request, admin, ticket } = await world();
    const detail = (await (await request(`/api/admin/tickets/${ticket.id}/investigations`, { method: "POST", cookie: admin.cookie })).json()) as AdminTicketDetail;
    expect(detail.investigations.map((i) => i.status)).toEqual(["queued", "queued"]);
    expect(detail.status).toBe("investigating");
  });

  test("updates status", async () => {
    const { request, admin, ticket } = await world();
    const detail = (await (await request(`/api/admin/tickets/${ticket.id}`, { method: "PATCH", cookie: admin.cookie, json: { status: "resolved" } })).json()) as AdminTicketDetail;
    expect(detail.status).toBe("resolved");
    expect((await request(`/api/admin/tickets/${ticket.id}`, { method: "PATCH", cookie: admin.cookie, json: { status: "bogus" } })).status).toBe(400);
  });
});

describe("projects", () => {
  test("creates, lists with counts, and edits the runbook", async () => {
    const { request, admin } = await world();
    const created = (await (await request("/api/admin/projects", { method: "POST", cookie: admin.cookie, json: { slug: "beta-shop", name: "Beta Shop" } })).json()) as ProjectDto;
    expect(created.slug).toBe("beta-shop");
    expect((await request("/api/admin/projects", { method: "POST", cookie: admin.cookie, json: { slug: "beta-shop", name: "Dup" } })).status).toBe(409);
    expect((await request("/api/admin/projects", { method: "POST", cookie: admin.cookie, json: { slug: "Bad Slug", name: "X" } })).status).toBe(400);

    const updated = (await (await request(`/api/admin/projects/${created.id}`, { method: "PATCH", cookie: admin.cookie, json: { runbook: "API is app `api`." } })).json()) as ProjectDto;
    expect(updated.runbook).toBe("API is app `api`.");

    const list = (await (await request("/api/admin/projects", { cookie: admin.cookie })).json()) as ProjectDto[];
    expect(list.find((p) => p.slug === "acme")).toMatchObject({ memberCount: 1, openTickets: 1 });
  });
});

describe("clients and invites", () => {
  test("lists clients with their projects and reassigns them", async () => {
    const { request, admin, client, createProject } = await world();
    const beta = await createProject("beta");
    const clients = (await (await request("/api/admin/clients", { cookie: admin.cookie })).json()) as ClientDto[];
    expect(clients.map((c) => c.email)).toEqual(["priya@acme.com"]);
    const updated = (await (await request(`/api/admin/clients/${client.id}/projects`, { method: "PUT", cookie: admin.cookie, json: { projectIds: [beta.id] } })).json()) as ClientDto;
    expect(updated.projects.map((p) => p.slug)).toEqual(["beta"]);
  });

  test("full invite flow: create link, preview, accept, sign in, see the project", async () => {
    const { request, admin, acme, signIn } = await world();
    const created = await request("/api/admin/invites", { method: "POST", cookie: admin.cookie, json: { email: "Rahul@Acme.com", name: "Rahul", projectIds: [acme.id] } });
    const inv = (await created.json()) as InviteDto;
    expect(inv.email).toBe("rahul@acme.com");
    expect(inv.url).toStartWith("http://localhost:3001/invite/");
    const token = inv.url.split("/").pop()!;

    const preview = (await (await request(`/api/invites/${token}`)).json()) as InvitePreview;
    expect(preview).toEqual({ email: "rahul@acme.com", name: "Rahul", projects: ["Acme Portal"] });

    expect((await request(`/api/invites/${token}/accept`, { method: "POST", json: { password: "short" } })).status).toBe(400);
    expect((await request(`/api/invites/${token}/accept`, { method: "POST", json: { password: "a-good-password" } })).status).toBe(200);
    expect((await request(`/api/invites/${token}`)).status).toBe(410);

    const cookie = await signIn("rahul@acme.com", "a-good-password");
    const me = (await (await request("/api/me", { cookie })).json()) as Me;
    expect(me.role).toBe("user");
    expect(me.projects.map((p) => p.slug)).toEqual(["acme"]);
  });

  test("refuses invites for existing accounts, expired links and unknown tokens", async () => {
    const { request, admin, db } = await world();
    expect((await request("/api/admin/invites", { method: "POST", cookie: admin.cookie, json: { email: "priya@acme.com", name: "P", projectIds: [] } })).status).toBe(409);

    const inv = (await (await request("/api/admin/invites", { method: "POST", cookie: admin.cookie, json: { email: "late@acme.com", name: "Late", projectIds: [] } })).json()) as InviteDto;
    await db.update(invite).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invite.id, inv.id));
    expect((await request(`/api/invites/${inv.url.split("/").pop()}`)).status).toBe(410);
    expect((await request("/api/invites/nope")).status).toBe(404);
  });

  test("revokes an unused invite", async () => {
    const { request, admin } = await world();
    const inv = (await (await request("/api/admin/invites", { method: "POST", cookie: admin.cookie, json: { email: "x@acme.com", name: "X", projectIds: [] } })).json()) as InviteDto;
    expect((await request(`/api/admin/invites/${inv.id}`, { method: "DELETE", cookie: admin.cookie })).status).toBe(200);
    const list = (await (await request("/api/admin/invites", { cookie: admin.cookie })).json()) as InviteDto[];
    expect(list).toHaveLength(0);
  });
});
