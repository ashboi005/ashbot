import type { TicketStatus } from "@ashbot/contracts";

export const STATUS_STEPS = ["Received", "Looking into it", "Reviewing", "Resolved"] as const;

const STEP_BY_STATUS: Record<TicketStatus, number> = { received: 0, investigating: 1, reported: 2, resolved: 3 };

export function clientStatus(status: TicketStatus): { step: number; label: string; live: boolean } {
  const step = STEP_BY_STATUS[status];
  return { step, label: STATUS_STEPS[step]!, live: status === "investigating" };
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function snapshotIdsIn(text: string): string[] {
  return text.match(/\bsnap_\d+\b/g) ?? [];
}

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickRecorderMime(isTypeSupported: (type: string) => boolean): string | undefined {
  return RECORDER_TYPES.find((type) => isTypeSupported(type));
}
