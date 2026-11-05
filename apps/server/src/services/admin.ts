import type {
  AdminTicketDetail,
  AdminTicketSummary,
  ClientDto,
  ProjectDto,
  Report,
  TicketStatus,
} from "@ashbot/contracts";
import type { Database } from "@ashbot/db";
import { investigation, project, projectMember, ticket, user } from "@ashbot/db/schema";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import { toInvestigationDto, toTicketSummary } from "../dto";
import { ApiError } from "../http";
import { getTicketDetail } from "./tickets";

async function latestInvestigations(db: Database, ticketIds: string[]) {
  if (ticketIds.length === 0) return new Map<string, typeof investigation.$inferSelect>();
  const rows = await db.select().from(investigation).where(inArray(investigation.ticketId, ticketIds)).orderBy(desc(investigation.queuedAt));
  const latest = new Map<string, typeof investigation.$inferSelect>();
  for (const row of rows) if (!latest.has(row.ticketId)) latest.set(row.ticketId, row);
  return latest;
}

export async function listAdminTickets(db: Database, filter: { status?: TicketStatus; projectId?: string }): Promise<AdminTicketSummary[]> {
  const rows = await db
    .select({ ticket, projectName: project.name, authorName: user.name, authorEmail: user.email })
    .from(ticket)
    .innerJoin(project, eq(project.id, ticket.projectId))
    .innerJoin(user, eq(user.id, ticket.authorId))
    .where(and(filter.status ? eq(ticket.status, filter.status) : undefined, filter.projectId ? eq(ticket.projectId, filter.projectId) : undefined))
    .orderBy(desc(ticket.updatedAt));
  const latest = await latestInvestigations(db, rows.map((r) => r.ticket.id));
  return rows.map((r) => {
    const inv = latest.get(r.ticket.id);
    return {
      ...toTicketSummary(r.ticket, r.projectName),
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      severity: (inv?.report as Report | null)?.severity ?? null,
      investigationStatus: inv?.status ?? null,
    };
  });
}

export async function getAdminTicketDetail(db: Database, ticketId: string): Promise<AdminTicketDetail> {
  const detail = await getTicketDetail(db, ticketId);
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(ticket)
    .innerJoin(user, eq(user.id, ticket.authorId))
    .where(eq(ticket.id, ticketId));
  const investigations = await db.select().from(investigation).where(eq(investigation.ticketId, ticketId)).orderBy(desc(investigation.queuedAt));
  return { ...detail, author: row!, investigations: investigations.map(toInvestigationDto) };
}

export async function setTicketStatus(db: Database, ticketId: string, status: TicketStatus) {
  const [row] = await db.update(ticket).set({ status }).where(eq(ticket.id, ticketId)).returning();
  if (!row) throw new ApiError(404, "That conversation doesn't exist.");
}

export async function listProjects(db: Database): Promise<ProjectDto[]> {
  const projects = await db.select().from(project).orderBy(asc(project.name));
  const members = await db.select({ projectId: projectMember.projectId }).from(projectMember);
  const open = await db.select({ projectId: ticket.projectId }).from(ticket).where(ne(ticket.status, "resolved"));
  return projects.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    runbook: p.runbook,
    createdAt: p.createdAt.toISOString(),
    memberCount: members.filter((m) => m.projectId === p.id).length,
    openTickets: open.filter((t) => t.projectId === p.id).length,
  }));
}

export async function createProject(db: Database, input: { slug: string; name: string; runbook?: string }) {
  const [existing] = await db.select().from(project).where(eq(project.slug, input.slug));
  if (existing) throw new ApiError(409, `A project with the id "${input.slug}" already exists.`);
  await db.insert(project).values({ slug: input.slug, name: input.name.trim(), runbook: input.runbook ?? "" });
  return (await listProjects(db)).find((p) => p.slug === input.slug)!;
}

export async function updateProject(db: Database, projectId: string, input: { name?: string; runbook?: string }) {
  const [row] = await db
    .update(project)
    .set({ ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.runbook !== undefined ? { runbook: input.runbook } : {}) })
    .where(eq(project.id, projectId))
    .returning();
  if (!row) throw new ApiError(404, "That project doesn't exist.");
  return (await listProjects(db)).find((p) => p.id === projectId)!;
}

export async function listClients(db: Database): Promise<ClientDto[]> {
  const clients = await db.select().from(user).where(ne(user.role, "admin")).orderBy(asc(user.name));
  const memberships = await db
    .select({ userId: projectMember.userId, id: project.id, slug: project.slug, name: project.name })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId));
  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    createdAt: c.createdAt.toISOString(),
    projects: memberships.filter((m) => m.userId === c.id).map(({ id, slug, name }) => ({ id, slug, name })),
  }));
}

export async function setClientProjects(db: Database, userId: string, projectIds: string[]) {
  const [client] = await db.select().from(user).where(eq(user.id, userId));
  if (!client || client.role === "admin") throw new ApiError(404, "That client doesn't exist.");
  await assertProjectsExist(db, projectIds);
  await db.delete(projectMember).where(eq(projectMember.userId, userId));
  if (projectIds.length > 0) await db.insert(projectMember).values(projectIds.map((projectId) => ({ userId, projectId })));
  return (await listClients(db)).find((c) => c.id === userId)!;
}

export async function assertProjectsExist(db: Database, projectIds: string[]) {
  if (projectIds.length === 0) return;
  const rows = await db.select({ id: project.id }).from(project).where(inArray(project.id, projectIds));
  if (rows.length !== new Set(projectIds).size) throw new ApiError(400, "One of the selected projects doesn't exist.");
}
