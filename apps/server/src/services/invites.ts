import type { Auth } from "@ashbot/auth";
import type { InviteDto, InvitePreview } from "@ashbot/contracts";
import type { Database } from "@ashbot/db";
import { invite, project, projectMember, user } from "@ashbot/db/schema";
import { desc, eq, inArray } from "drizzle-orm";

import { ApiError, type SessionUser } from "../http";
import { assertProjectsExist } from "./admin";

const INVITE_DAYS = 7;

function toInviteDto(row: typeof invite.$inferSelect, webOrigin: string): InviteDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    projectIds: row.projectIds,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    url: `${webOrigin}/invite/${row.token}`,
  };
}

export async function listInvites(db: Database, webOrigin: string): Promise<InviteDto[]> {
  const rows = await db.select().from(invite).orderBy(desc(invite.createdAt));
  return rows.map((r) => toInviteDto(r, webOrigin));
}

export async function createInvite(
  db: Database,
  webOrigin: string,
  admin: SessionUser,
  input: { email: string; name: string; projectIds: string[] },
): Promise<InviteDto> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) throw new ApiError(409, "Someone with that email already has an account.");
  await assertProjectsExist(db, input.projectIds);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  const [row] = await db
    .insert(invite)
    .values({
      token,
      email,
      name: input.name.trim(),
      projectIds: input.projectIds,
      createdBy: admin.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning();
  return toInviteDto(row!, webOrigin);
}

export async function deleteInvite(db: Database, inviteId: string) {
  const [row] = await db.select().from(invite).where(eq(invite.id, inviteId));
  if (!row) throw new ApiError(404, "That invite doesn't exist.");
  if (row.acceptedAt) throw new ApiError(409, "That invite was already accepted.");
  await db.delete(invite).where(eq(invite.id, inviteId));
}

async function usableInvite(db: Database, token: string) {
  const [row] = await db.select().from(invite).where(eq(invite.token, token));
  if (!row) throw new ApiError(404, "This invite link isn't valid. Ask for a new one.");
  if (row.acceptedAt) throw new ApiError(410, "This invite was already used. Sign in instead.");
  if (row.expiresAt.getTime() < Date.now()) throw new ApiError(410, "This invite has expired. Ask for a new one.");
  return row;
}

export async function previewInvite(db: Database, token: string): Promise<InvitePreview> {
  const row = await usableInvite(db, token);
  const projects = row.projectIds.length > 0 ? await db.select({ name: project.name }).from(project).where(inArray(project.id, row.projectIds)) : [];
  return { email: row.email, name: row.name, projects: projects.map((p) => p.name) };
}

export async function acceptInvite(db: Database, auth: Auth, token: string, input: { password: string; name?: string }) {
  const row = await usableInvite(db, token);
  const [existing] = await db.select().from(user).where(eq(user.email, row.email));
  if (existing) throw new ApiError(409, "Someone with that email already has an account. Sign in instead.");

  const { user: created } = await auth.api.createUser({
    body: { email: row.email, password: input.password, name: input.name?.trim() || row.name, role: "user" },
  });
  const projectIds = row.projectIds.length > 0 ? (await db.select({ id: project.id }).from(project).where(inArray(project.id, row.projectIds))).map((p) => p.id) : [];
  if (projectIds.length > 0) await db.insert(projectMember).values(projectIds.map((projectId) => ({ userId: created.id, projectId })));
  await db.update(invite).set({ acceptedAt: new Date() }).where(eq(invite.id, row.id));
  return { email: row.email };
}
