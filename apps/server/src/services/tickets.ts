import type { Me, TicketDetail, TicketSummary } from "@ashbot/contracts";
import type { Database } from "@ashbot/db";
import { attachment, investigation, message, project, projectMember, ticket, user } from "@ashbot/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { toMessageDto, toTicketSummary } from "../dto";
import { ApiError, type SessionUser } from "../http";

export const ACKNOWLEDGEMENT = "Thanks — I'm looking into it. I'll reply here as soon as I know more.";

const TITLE_LENGTH = 80;

export async function projectsFor(db: Database, viewer: SessionUser) {
  if (viewer.role === "admin") {
    return db.select({ id: project.id, slug: project.slug, name: project.name }).from(project).orderBy(asc(project.name));
  }
  return db
    .select({ id: project.id, slug: project.slug, name: project.name })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(eq(projectMember.userId, viewer.id))
    .orderBy(asc(project.name));
}

export async function getMe(db: Database, viewer: SessionUser): Promise<Me> {
  return { ...viewer, projects: await projectsFor(db, viewer) };
}

async function assertMember(db: Database, viewer: SessionUser, projectId: string) {
  if (viewer.role === "admin") return;
  const [row] = await db
    .select()
    .from(projectMember)
    .where(and(eq(projectMember.userId, viewer.id), eq(projectMember.projectId, projectId)));
  if (!row) throw new ApiError(403, "You don't have access to that project.");
}

async function claimAttachments(db: Database, uploaderId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return [];
  const rows = await db
    .select()
    .from(attachment)
    .where(and(inArray(attachment.id, attachmentIds), eq(attachment.uploaderId, uploaderId), isNull(attachment.messageId)));
  if (rows.length !== new Set(attachmentIds).size) throw new ApiError(400, "One of the attachments is missing or already used. Upload it again.");
  return rows;
}

function titleFor(body: string, attachments: { kind: string; transcriptEnglish: string | null }[]): string {
  const fromText = body.trim().split("\n")[0]?.trim();
  const fromVoice = attachments.find((a) => a.kind === "audio" && a.transcriptEnglish)?.transcriptEnglish?.trim();
  const title = fromText || fromVoice || (attachments.some((a) => a.kind === "audio") ? "Voice note" : "Screenshot");
  return title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1)}…` : title;
}

export async function insertMessage(
  db: Database,
  input: { ticketId: string; authorId: string | null; kind: "client" | "admin" | "system"; body: string; attachmentIds?: string[] },
) {
  const [row] = await db
    .insert(message)
    .values({ ticketId: input.ticketId, authorId: input.authorId, kind: input.kind, body: input.body.trim() })
    .returning();
  if (input.attachmentIds && input.attachmentIds.length > 0) {
    await db.update(attachment).set({ messageId: row!.id }).where(inArray(attachment.id, input.attachmentIds));
  }
  await db.update(ticket).set({ updatedAt: new Date() }).where(eq(ticket.id, input.ticketId));
  return row!;
}

export async function queueInvestigation(db: Database, ticketId: string) {
  const [row] = await db.insert(investigation).values({ ticketId }).returning();
  await db.update(ticket).set({ status: "investigating" }).where(eq(ticket.id, ticketId));
  return row!;
}

export async function createTicket(
  db: Database,
  viewer: SessionUser,
  input: { projectId: string; body: string; attachmentIds: string[] },
): Promise<TicketDetail> {
  await assertMember(db, viewer, input.projectId);
  if (input.body.trim() === "" && input.attachmentIds.length === 0) throw new ApiError(400, "Write a message, attach a screenshot, or record a voice note.");
  const attachments = await claimAttachments(db, viewer.id, input.attachmentIds);

  const [created] = await db
    .insert(ticket)
    .values({ projectId: input.projectId, authorId: viewer.id, title: titleFor(input.body, attachments) })
    .returning();
  await insertMessage(db, { ticketId: created!.id, authorId: viewer.id, kind: "client", body: input.body, attachmentIds: input.attachmentIds });
  await insertMessage(db, { ticketId: created!.id, authorId: null, kind: "system", body: ACKNOWLEDGEMENT });
  await queueInvestigation(db, created!.id);
  return getTicketDetail(db, created!.id);
}

export async function addClientMessage(
  db: Database,
  viewer: SessionUser,
  ticketId: string,
  input: { body: string; attachmentIds: string[] },
): Promise<TicketDetail> {
  const row = await findTicket(db, ticketId, viewer);
  if (input.body.trim() === "" && input.attachmentIds.length === 0) throw new ApiError(400, "Write a message, attach a screenshot, or record a voice note.");
  await claimAttachments(db, viewer.id, input.attachmentIds);
  await insertMessage(db, { ticketId, authorId: viewer.id, kind: "client", body: input.body, attachmentIds: input.attachmentIds });
  if (row.status === "resolved") await db.update(ticket).set({ status: "received" }).where(eq(ticket.id, ticketId));
  return getTicketDetail(db, ticketId);
}

// Clients only see their own tickets; admins see all. Missing and forbidden look the same (404).
export async function findTicket(db: Database, ticketId: string, viewer: SessionUser) {
  const [row] = await db.select().from(ticket).where(eq(ticket.id, ticketId));
  if (!row || (viewer.role !== "admin" && row.authorId !== viewer.id)) throw new ApiError(404, "That conversation doesn't exist.");
  return row;
}

export async function listClientTickets(db: Database, viewer: SessionUser, projectId?: string): Promise<TicketSummary[]> {
  const rows = await db
    .select({ ticket, projectName: project.name })
    .from(ticket)
    .innerJoin(project, eq(project.id, ticket.projectId))
    .where(and(eq(ticket.authorId, viewer.id), projectId ? eq(ticket.projectId, projectId) : undefined))
    .orderBy(desc(ticket.updatedAt));
  return rows.map((r) => toTicketSummary(r.ticket, r.projectName));
}

export async function getTicketDetail(db: Database, ticketId: string): Promise<TicketDetail> {
  const [row] = await db
    .select({ ticket, projectName: project.name })
    .from(ticket)
    .innerJoin(project, eq(project.id, ticket.projectId))
    .where(eq(ticket.id, ticketId));
  if (!row) throw new ApiError(404, "That conversation doesn't exist.");

  const messages = await db
    .select({ message, authorName: user.name })
    .from(message)
    .leftJoin(user, eq(user.id, message.authorId))
    .where(eq(message.ticketId, ticketId))
    .orderBy(asc(message.createdAt));
  const messageIds = messages.map((m) => m.message.id);
  const attachments =
    messageIds.length > 0 ? await db.select().from(attachment).where(inArray(attachment.messageId, messageIds)).orderBy(asc(attachment.createdAt)) : [];

  return {
    ...toTicketSummary(row.ticket, row.projectName),
    messages: messages.map((m) =>
      toMessageDto(
        m.message,
        m.authorName,
        attachments.filter((a) => a.messageId === m.message.id),
      ),
    ),
  };
}
