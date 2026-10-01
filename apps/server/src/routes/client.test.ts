import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { investigation } from "@ashbot/db/schema";
import { createLocalStorage } from "@ashbot/integrations/storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttachmentDto, Me, TicketDetail, TicketSummary } from "@ashbot/contracts";

import { setup, uploadForm } from "../test/setup";

async function clientWithProject() {
  const ctx = await setup();
  const client = await ctx.createUser("user", "client@acme.com", "Priya");
  const acme = await ctx.createProject("acme", "Acme Portal");
  await ctx.addMember(client.id, acme.id);
  return { ...ctx, client, acme };
}

describe("GET /api/me", () => {
  test("401 without a session", async () => {
    const { request } = await setup();
    expect((await request("/api/me")).status).toBe(401);
  });

  test("returns the client with only their projects", async () => {
    const { request, client, createProject } = await clientWithProject();
    await createProject("other");
    const me = (await (await request("/api/me", { cookie: client.cookie })).json()) as Me;
    expect(me.role).toBe("user");
    expect(me.name).toBe("Priya");
    expect(me.projects.map((p) => p.slug)).toEqual(["acme"]);
  });

  test("admins see every project", async () => {
    const { request, createUser, createProject } = await setup();
    await createProject("a");
    await createProject("b");
    const admin = await createUser("admin", "ash@studio.com");
    const me = (await (await request("/api/me", { cookie: admin.cookie })).json()) as Me;
    expect(me.role).toBe("admin");
    expect(me.projects).toHaveLength(2);
  });
});

describe("POST /api/uploads", () => {
  test("stores an image and returns an attachment", async () => {
    const { request, client } = await clientWithProject();
    const res = await request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([137, 80, 78, 71]), "image/png", "shot.png") });
    expect(res.status).toBe(200);
    const att = (await res.json()) as AttachmentDto;
    expect(att.kind).toBe("image");
    expect(att.url).toBe(`/api/attachments/${att.id}`);
    expect(att.transcript).toBeNull();
  });

  test("transcribes voice notes and cleans non-English speech into English", async () => {
    const { request, client } = await clientWithProject();
    const res = await request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus", "note.webm") });
    const att = (await res.json()) as AttachmentDto;
    expect(att.kind).toBe("audio");
    expect(att.transcript).toBe("checkout kaam nahi kar raha");
    expect(att.transcriptEnglish).toBe("The checkout is not working.");
    expect(att.language).toBe("hi,en");
  });

  test("passes English voice notes through without cleanup", async () => {
    let cleaned = false;
    const ctx = await setup({
      transcribe: async () => ({ transcript: "The login page is blank", languages: ["en"] }),
      cleanup: async (text) => {
        cleaned = true;
        return text;
      },
    });
    const client = await ctx.createUser("user", "c@x.com");
    const att = (await (await ctx.request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1]), "audio/webm", "n.webm") })).json()) as AttachmentDto;
    expect(att.transcriptEnglish).toBe("The login page is blank");
    expect(cleaned).toBe(false);
  });

  test("keeps the voice note when transcription is not configured", async () => {
    const ctx = await setup({ transcribe: undefined, cleanup: undefined });
    const client = await ctx.createUser("user", "c@x.com");
    const res = await ctx.request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1]), "audio/webm", "n.webm") });
    const att = (await res.json()) as AttachmentDto;
    expect(res.status).toBe(200);
    expect(att.transcript).toBeNull();
  });

  test("rejects unsupported file types", async () => {
    const { request, client } = await clientWithProject();
    const res = await request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1]), "application/pdf", "a.pdf") });
    expect(res.status).toBe(415);
  });
});

describe("conversations", () => {
  test("first message creates a ticket, acknowledges, and queues an investigation", async () => {
    const { request, client, acme, db } = await clientWithProject();
    const img = (await (await request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1]), "image/png", "a.png") })).json()) as AttachmentDto;

    const res = await request("/api/tickets", {
      method: "POST",
      cookie: client.cookie,
      json: { projectId: acme.id, body: "Checkout spins forever since this morning", attachmentIds: [img.id] },
    });
    expect(res.status).toBe(200);
    const ticket = (await res.json()) as TicketDetail;
    expect(ticket.title).toBe("Checkout spins forever since this morning");
    expect(ticket.status).toBe("investigating");
    expect(ticket.projectName).toBe("Acme Portal");
    expect(ticket.messages.map((m) => m.kind)).toEqual(["client", "system"]);
    expect(ticket.messages[0]?.attachments.map((a) => a.id)).toEqual([img.id]);
    expect(ticket.messages[1]?.body).toContain("looking into it");

    const queued = await db.select().from(investigation).where(eq(investigation.ticketId, ticket.id));
    expect(queued.map((i) => i.status)).toEqual(["queued"]);
  });

  test("a voice-only message gets a title from its transcript", async () => {
    const { request, client, acme } = await clientWithProject();
    const voice = (await (await request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1]), "audio/webm", "n.webm") })).json()) as AttachmentDto;
    const ticket = (await (await request("/api/tickets", { method: "POST", cookie: client.cookie, json: { projectId: acme.id, body: "", attachmentIds: [voice.id] } })).json()) as TicketDetail;
    expect(ticket.title).toBe("The checkout is not working.");
  });

  test("rejects an empty message", async () => {
    const { request, client, acme } = await clientWithProject();
    const res = await request("/api/tickets", { method: "POST", cookie: client.cookie, json: { projectId: acme.id, body: "  ", attachmentIds: [] } });
    expect(res.status).toBe(400);
  });

  test("cannot open a ticket on a project they are not a member of", async () => {
    const { request, client, createProject } = await clientWithProject();
    const other = await createProject("other");
    const res = await request("/api/tickets", { method: "POST", cookie: client.cookie, json: { projectId: other.id, body: "hi", attachmentIds: [] } });
    expect(res.status).toBe(403);
  });

  test("cannot attach someone else's upload", async () => {
    const ctx = await clientWithProject();
    const mallory = await ctx.createUser("user", "m@evil.com");
    const img = (await (await ctx.request("/api/uploads", { method: "POST", cookie: mallory.cookie, body: uploadForm(new Uint8Array([1]), "image/png", "a.png") })).json()) as AttachmentDto;
    const res = await ctx.request("/api/tickets", { method: "POST", cookie: ctx.client.cookie, json: { projectId: ctx.acme.id, body: "hi", attachmentIds: [img.id] } });
    expect(res.status).toBe(400);
  });

  test("lists only the client's own tickets and hides other clients' tickets", async () => {
    const ctx = await clientWithProject();
    const colleague = await ctx.createUser("user", "colleague@acme.com");
    await ctx.addMember(colleague.id, ctx.acme.id);
    const mine = (await (await ctx.request("/api/tickets", { method: "POST", cookie: ctx.client.cookie, json: { projectId: ctx.acme.id, body: "mine", attachmentIds: [] } })).json()) as TicketDetail;
    await ctx.request("/api/tickets", { method: "POST", cookie: colleague.cookie, json: { projectId: ctx.acme.id, body: "theirs", attachmentIds: [] } });

    const list = (await (await ctx.request(`/api/tickets?projectId=${ctx.acme.id}`, { cookie: ctx.client.cookie })).json()) as TicketSummary[];
    expect(list.map((t) => t.title)).toEqual(["mine"]);
    expect((await ctx.request(`/api/tickets/${mine.id}`, { cookie: colleague.cookie })).status).toBe(404);
  });

  test("follow-up messages are added to the thread and reopen resolved tickets", async () => {
    const ctx = await clientWithProject();
    const admin = await ctx.createUser("admin", "ash@studio.com");
    const ticket = (await (await ctx.request("/api/tickets", { method: "POST", cookie: ctx.client.cookie, json: { projectId: ctx.acme.id, body: "broken", attachmentIds: [] } })).json()) as TicketDetail;
    await ctx.request(`/api/admin/tickets/${ticket.id}`, { method: "PATCH", cookie: admin.cookie, json: { status: "resolved" } });

    const res = await ctx.request(`/api/tickets/${ticket.id}/messages`, { method: "POST", cookie: ctx.client.cookie, json: { body: "It's broken again", attachmentIds: [] } });
    const updated = (await res.json()) as TicketDetail;
    expect(updated.status).toBe("received");
    expect(updated.messages.at(-1)?.body).toBe("It's broken again");
  });
});

describe("GET /api/attachments/:id", () => {
  test("streams the file to its owner and refuses other clients", async () => {
    const ctx = await clientWithProject();
    const mallory = await ctx.createUser("user", "m@evil.com");
    const img = (await (await ctx.request("/api/uploads", { method: "POST", cookie: ctx.client.cookie, body: uploadForm(new Uint8Array([7, 7]), "image/png", "a.png") })).json()) as AttachmentDto;

    const own = await ctx.request(img.url, { cookie: ctx.client.cookie });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await own.arrayBuffer())]).toEqual([7, 7]);
    expect((await ctx.request(img.url, { cookie: mallory.cookie })).status).toBe(404);
  });

  test("redirects to a presigned URL when storage provides one", async () => {
    const local = createLocalStorage(await mkdtemp(join(tmpdir(), "ashbot-s3-")));
    const ctx = await setup({ storage: { ...local, url: async () => "https://s3.example/presigned" } });
    const client = await ctx.createUser("user", "c@x.com");
    const img = (await (await ctx.request("/api/uploads", { method: "POST", cookie: client.cookie, body: uploadForm(new Uint8Array([1]), "image/png", "a.png") })).json()) as AttachmentDto;
    const res = await ctx.request(img.url, { cookie: client.cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s3.example/presigned");
  });
});
