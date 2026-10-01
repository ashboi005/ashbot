import type {
  AttachmentDto,
  InvestigationDto,
  MessageDto,
  Report,
  Snapshot,
  TicketSummary,
  ToolCallRecord,
} from "@ashbot/contracts";
import type { attachment, investigation, message, ticket } from "@ashbot/db/schema";

type AttachmentRow = typeof attachment.$inferSelect;
type MessageRow = typeof message.$inferSelect;
type TicketRow = typeof ticket.$inferSelect;
type InvestigationRow = typeof investigation.$inferSelect;

export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    size: row.size,
    url: `/api/attachments/${row.id}`,
    transcript: row.transcript,
    transcriptEnglish: row.transcriptEnglish,
    language: row.language,
  };
}

export function toMessageDto(row: MessageRow, authorName: string | null, attachments: AttachmentRow[]): MessageDto {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    authorName,
    createdAt: row.createdAt.toISOString(),
    attachments: attachments.map(toAttachmentDto),
  };
}

export function toTicketSummary(row: TicketRow, projectName: string): TicketSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toInvestigationDto(row: InvestigationRow): InvestigationDto {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    stopReason: row.stopReason,
    report: (row.report as Report | null) ?? null,
    toolCalls: (row.toolCalls as ToolCallRecord[] | null) ?? [],
    snapshots: (row.snapshots as Snapshot[] | null) ?? [],
    usage: (row.usage as InvestigationDto["usage"]) ?? null,
    error: row.error,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
