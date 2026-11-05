import type { AttachmentDto } from "@ashbot/contracts";
import type { Database } from "@ashbot/db";
import { attachment, message, ticket } from "@ashbot/db/schema";
import type { Storage } from "@ashbot/integrations/storage";
import { needsEnglishCleanup } from "@ashbot/agent/voice";
import { eq } from "drizzle-orm";

import { toAttachmentDto } from "../dto";
import { ApiError, type SessionUser } from "../http";

const MB = 1024 * 1024;

type Rule = { kind: "image" | "audio"; ext: string; maxBytes: number; storeAs?: string };

// Multipart parsers (Bun included) infer the type from the file extension, so a recorded
// voice note named *.webm arrives as video/webm. Voice notes are the only video we accept.
const ALLOWED: Record<string, Rule> = {
  "video/webm": { kind: "audio", ext: "webm", maxBytes: 25 * MB, storeAs: "audio/webm" },
  "video/mp4": { kind: "audio", ext: "m4a", maxBytes: 25 * MB, storeAs: "audio/mp4" },
  "image/png": { kind: "image", ext: "png", maxBytes: 10 * MB },
  "image/jpeg": { kind: "image", ext: "jpg", maxBytes: 10 * MB },
  "image/webp": { kind: "image", ext: "webp", maxBytes: 10 * MB },
  "image/gif": { kind: "image", ext: "gif", maxBytes: 10 * MB },
  "audio/webm": { kind: "audio", ext: "webm", maxBytes: 25 * MB },
  "audio/ogg": { kind: "audio", ext: "ogg", maxBytes: 25 * MB },
  "audio/mp4": { kind: "audio", ext: "m4a", maxBytes: 25 * MB },
  "audio/x-m4a": { kind: "audio", ext: "m4a", maxBytes: 25 * MB },
  "audio/mpeg": { kind: "audio", ext: "mp3", maxBytes: 25 * MB },
  "audio/wav": { kind: "audio", ext: "wav", maxBytes: 25 * MB },
};

export type Transcribe = (audio: Uint8Array, mimeType: string) => Promise<{ transcript: string; languages: string[] }>;
export type Cleanup = (transcript: string) => Promise<string>;

export async function saveUpload(
  deps: { db: Database; storage: Storage; transcribe?: Transcribe; cleanup?: Cleanup },
  viewer: SessionUser,
  file: File,
): Promise<AttachmentDto> {
  const mimeType = file.type.split(";")[0]!.trim().toLowerCase();
  const rule = ALLOWED[mimeType];
  if (!rule) throw new ApiError(415, "Only images (PNG, JPG, WebP, GIF) and voice notes can be attached.");
  if (file.size > rule.maxBytes) throw new ApiError(413, `That file is too large. The limit is ${rule.maxBytes / MB} MB.`);

  const storedType = rule.storeAs ?? mimeType;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const storageKey = `uploads/${viewer.id}/${crypto.randomUUID()}.${rule.ext}`;
  await deps.storage.put(storageKey, bytes, storedType);

  let transcript: string | null = null;
  let transcriptEnglish: string | null = null;
  let language: string | null = null;
  if (rule.kind === "audio" && deps.transcribe) {
    try {
      const result = await deps.transcribe(bytes, storedType);
      transcript = result.transcript;
      language = result.languages.join(",") || null;
      transcriptEnglish = deps.cleanup && needsEnglishCleanup(result) ? await deps.cleanup(result.transcript) : result.transcript;
    } catch (err) {
      // The voice note is still kept; the engineer can listen to it.
      console.error("Transcription failed", err);
    }
  }

  const [row] = await deps.db
    .insert(attachment)
    .values({ uploaderId: viewer.id, kind: rule.kind, storageKey, mimeType: storedType, size: bytes.length, transcript, transcriptEnglish, language })
    .returning();
  return toAttachmentDto(row!);
}

export async function openAttachment(deps: { db: Database; storage: Storage }, viewer: SessionUser, attachmentId: string) {
  const [row] = await deps.db
    .select({ attachment, ticketAuthorId: ticket.authorId })
    .from(attachment)
    .leftJoin(message, eq(message.id, attachment.messageId))
    .leftJoin(ticket, eq(ticket.id, message.ticketId))
    .where(eq(attachment.id, attachmentId));
  const allowed = row && (viewer.role === "admin" || row.attachment.uploaderId === viewer.id || row.ticketAuthorId === viewer.id);
  if (!row || !allowed) throw new ApiError(404, "That file doesn't exist.");

  const url = await deps.storage.url(row.attachment.storageKey);
  if (url) return new Response(null, { status: 302, headers: { location: url } });
  const bytes = await deps.storage.get(row.attachment.storageKey);
  return new Response(bytes, { headers: { "content-type": row.attachment.mimeType, "cache-control": "private, max-age=300" } });
}
