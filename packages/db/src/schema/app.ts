import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at").defaultNow().notNull();

export const project = pgTable("project", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  runbook: text("runbook").notNull().default(""),
  createdAt: createdAt(),
});

export const projectMember = pgTable(
  "project_member",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.projectId] })],
);

export const invite = pgTable("invite", {
  id: id(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  projectIds: jsonb("project_ids").$type<string[]>().notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: createdAt(),
});

export const ticketStatus = pgEnum("ticket_status", ["received", "investigating", "reported", "resolved"]);

export const ticket = pgTable(
  "ticket",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: ticketStatus("status").notNull().default("received"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("ticket_project_idx").on(table.projectId), index("ticket_author_idx").on(table.authorId)],
);

export const messageKind = pgEnum("message_kind", ["client", "admin", "system"]);

export const message = pgTable(
  "message",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    kind: messageKind("kind").notNull(),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [index("message_ticket_idx").on(table.ticketId)],
);

export const attachmentKind = pgEnum("attachment_kind", ["image", "audio"]);

export const attachment = pgTable(
  "attachment",
  {
    id: id(),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => message.id, { onDelete: "cascade" }),
    kind: attachmentKind("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    transcript: text("transcript"),
    transcriptEnglish: text("transcript_english"),
    language: text("language"),
    createdAt: createdAt(),
  },
  (table) => [index("attachment_message_idx").on(table.messageId)],
);

export const investigationStatus = pgEnum("investigation_status", ["queued", "running", "done", "failed"]);

export const investigation = pgTable(
  "investigation",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    status: investigationStatus("status").notNull().default("queued"),
    model: text("model"),
    stopReason: text("stop_reason"),
    report: jsonb("report"),
    toolCalls: jsonb("tool_calls"),
    snapshots: jsonb("snapshots"),
    usage: jsonb("usage"),
    error: text("error"),
    queuedAt: timestamp("queued_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("investigation_ticket_idx").on(table.ticketId), index("investigation_status_idx").on(table.status)],
);
