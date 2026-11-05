// API shapes shared by apps/server (producer) and apps/web (consumer). Types only.
import type { ToolCallRecord } from "@ashbot/agent/harness";
import type { Report } from "@ashbot/agent/report";
import type { Snapshot } from "@ashbot/agent/snapshots";

export type { Report, Snapshot, ToolCallRecord };

export type Role = "admin" | "user";
export type TicketStatus = "received" | "investigating" | "reported" | "resolved";
export type MessageKind = "client" | "admin" | "system";
export type AttachmentKind = "image" | "audio";
export type InvestigationStatus = "queued" | "running" | "done" | "failed";

export type ProjectSummary = { id: string; slug: string; name: string };

export type Me = { id: string; name: string; email: string; role: Role; projects: ProjectSummary[] };

export type AttachmentDto = {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  url: string;
  transcript: string | null;
  transcriptEnglish: string | null;
  language: string | null;
};

export type MessageDto = {
  id: string;
  kind: MessageKind;
  body: string;
  authorName: string | null;
  createdAt: string;
  attachments: AttachmentDto[];
};

export type TicketSummary = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
};

export type TicketDetail = TicketSummary & { messages: MessageDto[] };

export type InvestigationDto = {
  id: string;
  status: InvestigationStatus;
  model: string | null;
  stopReason: string | null;
  report: Report | null;
  toolCalls: ToolCallRecord[];
  snapshots: Snapshot[];
  usage: { promptTokens: number; completionTokens: number } | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type AdminTicketSummary = TicketSummary & {
  authorName: string;
  authorEmail: string;
  severity: Report["severity"] | null;
  investigationStatus: InvestigationStatus | null;
};

export type AdminTicketDetail = TicketDetail & {
  author: { id: string; name: string; email: string };
  investigations: InvestigationDto[];
};

export type ProjectDto = ProjectSummary & { runbook: string; createdAt: string; memberCount: number; openTickets: number };

export type ClientDto = { id: string; name: string; email: string; createdAt: string; projects: ProjectSummary[] };

export type InviteDto = {
  id: string;
  email: string;
  name: string;
  projectIds: string[];
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  url: string;
};

export type InvitePreview = { email: string; name: string; projects: string[] };

export type ApiError = { error: string };
