import type { Auth } from "@ashbot/auth";
import type { Database } from "@ashbot/db";
import type { Storage } from "@ashbot/integrations/storage";
import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";

import { ApiError, requireAdmin, requireUser, sessionUser } from "./http";
import {
  createProject,
  getAdminTicketDetail,
  listAdminTickets,
  listClients,
  listProjects,
  setClientProjects,
  setTicketStatus,
  updateProject,
} from "./services/admin";
import { acceptInvite, createInvite, deleteInvite, listInvites, previewInvite } from "./services/invites";
import {
  addClientMessage,
  createTicket,
  findTicket,
  getMe,
  getTicketDetail,
  insertMessage,
  listClientTickets,
  queueInvestigation,
} from "./services/tickets";
import { openAttachment, saveUpload, type Cleanup, type Transcribe } from "./services/uploads";

export type AppDeps = {
  db: Database;
  auth: Auth;
  storage: Storage;
  webOrigin: string;
  corsOrigin: string;
  transcribe?: Transcribe;
  cleanup?: Cleanup;
};

const ticketStatus = t.Union([t.Literal("received"), t.Literal("investigating"), t.Literal("reported"), t.Literal("resolved")]);
const messageBody = t.Object({ body: t.String({ maxLength: 10_000 }), attachmentIds: t.Array(t.String(), { maxItems: 10, default: [] }) });

export function createApp(deps: AppDeps) {
  const { db, auth } = deps;

  return new Elysia()
    .use(
      cors({
        origin: deps.corsOrigin,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
      }),
    )
    .onError({ as: "global" }, ({ code, error, set }) => {
      if (error instanceof ApiError) {
        set.status = error.status;
        return { error: error.message };
      }
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Some fields are missing or invalid." };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found." };
      }
      console.error(error);
      set.status = 500;
      return { error: "Something went wrong on our side. Try again in a moment." };
    })
    .all("/api/auth/*", ({ request, status }) => (["POST", "GET"].includes(request.method) ? auth.handler(request) : status(405)))
    .get("/", () => "OK")
    .derive(async ({ request }) => ({ viewer: await sessionUser(auth, request.headers) }))

    // Client + shared
    .get("/api/me", ({ viewer }) => getMe(db, requireUser(viewer)))
    .post("/api/uploads", async ({ viewer, body }) => {
      const signedIn = requireUser(viewer);
      const file = (body as Record<string, unknown> | null)?.file;
      if (!(file instanceof File)) throw new ApiError(400, "Choose a file to upload.");
      return saveUpload(deps, signedIn, file);
    })
    .get("/api/attachments/:id", ({ viewer, params }) => openAttachment(deps, requireUser(viewer), params.id))
    .get("/api/tickets", ({ viewer, query }) => listClientTickets(db, requireUser(viewer), query.projectId), {
      query: t.Object({ projectId: t.Optional(t.String()) }),
    })
    .post("/api/tickets", ({ viewer, body }) => createTicket(db, requireUser(viewer), body), {
      body: t.Composite([t.Object({ projectId: t.String() }), messageBody]),
    })
    .get("/api/tickets/:id", async ({ viewer, params }) => {
      await findTicket(db, params.id, requireUser(viewer));
      return getTicketDetail(db, params.id);
    })
    .post("/api/tickets/:id/messages", ({ viewer, params, body }) => addClientMessage(db, requireUser(viewer), params.id, body), {
      body: messageBody,
    })

    // Invites (public)
    .get("/api/invites/:token", ({ params }) => previewInvite(db, params.token))
    .post("/api/invites/:token/accept", ({ params, body }) => acceptInvite(db, auth, params.token, body), {
      body: t.Object({ password: t.String({ minLength: 8, maxLength: 128 }), name: t.Optional(t.String({ maxLength: 100 })) }),
    })

    // Admin
    .get("/api/admin/tickets", ({ viewer, query }) => {
      requireAdmin(viewer);
      return listAdminTickets(db, query);
    }, { query: t.Object({ status: t.Optional(ticketStatus), projectId: t.Optional(t.String()) }) })
    .get("/api/admin/tickets/:id", ({ viewer, params }) => {
      requireAdmin(viewer);
      return getAdminTicketDetail(db, params.id);
    })
    .patch("/api/admin/tickets/:id", async ({ viewer, params, body }) => {
      requireAdmin(viewer);
      await setTicketStatus(db, params.id, body.status);
      return getAdminTicketDetail(db, params.id);
    }, { body: t.Object({ status: ticketStatus }) })
    .post("/api/admin/tickets/:id/messages", async ({ viewer, params, body }) => {
      const admin = requireAdmin(viewer);
      await findTicket(db, params.id, admin);
      await insertMessage(db, { ticketId: params.id, authorId: admin.id, kind: "admin", body: body.body });
      return getAdminTicketDetail(db, params.id);
    }, { body: t.Object({ body: t.String({ minLength: 1, maxLength: 10_000 }) }) })
    .post("/api/admin/tickets/:id/investigations", async ({ viewer, params }) => {
      const admin = requireAdmin(viewer);
      await findTicket(db, params.id, admin);
      await queueInvestigation(db, params.id);
      return getAdminTicketDetail(db, params.id);
    })
    .get("/api/admin/projects", ({ viewer }) => {
      requireAdmin(viewer);
      return listProjects(db);
    })
    .post("/api/admin/projects", ({ viewer, body }) => {
      requireAdmin(viewer);
      return createProject(db, body);
    }, {
      body: t.Object({
        slug: t.String({ pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: 64 }),
        name: t.String({ minLength: 1, maxLength: 120 }),
        runbook: t.Optional(t.String({ maxLength: 50_000 })),
      }),
    })
    .patch("/api/admin/projects/:id", ({ viewer, params, body }) => {
      requireAdmin(viewer);
      return updateProject(db, params.id, body);
    }, { body: t.Object({ name: t.Optional(t.String({ minLength: 1, maxLength: 120 })), runbook: t.Optional(t.String({ maxLength: 50_000 })) }) })
    .get("/api/admin/clients", ({ viewer }) => {
      requireAdmin(viewer);
      return listClients(db);
    })
    .put("/api/admin/clients/:id/projects", ({ viewer, params, body }) => {
      requireAdmin(viewer);
      return setClientProjects(db, params.id, body.projectIds);
    }, { body: t.Object({ projectIds: t.Array(t.String()) }) })
    .get("/api/admin/invites", ({ viewer }) => {
      requireAdmin(viewer);
      return listInvites(db, deps.webOrigin);
    })
    .post("/api/admin/invites", ({ viewer, body }) => createInvite(db, deps.webOrigin, requireAdmin(viewer), body), {
      body: t.Object({ email: t.String({ format: "email" }), name: t.String({ minLength: 1, maxLength: 100 }), projectIds: t.Array(t.String()) }),
    })
    .delete("/api/admin/invites/:id", async ({ viewer, params }) => {
      requireAdmin(viewer);
      await deleteInvite(db, params.id);
      return { ok: true };
    });
}

export type App = ReturnType<typeof createApp>;
