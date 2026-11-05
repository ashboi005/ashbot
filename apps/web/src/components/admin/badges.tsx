import type { InvestigationStatus, Report, TicketStatus } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";

const SEVERITY_CLASS: Record<Report["severity"], string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
};

export function SeverityBadge({ severity, className }: { severity: Report["severity"] | null; className?: string }) {
  if (!severity) return <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium capitalize", className)}>
      <span aria-hidden className={cn("size-2 rounded-[2px]", SEVERITY_CLASS[severity])} />
      {severity}
    </span>
  );
}

const TICKET_STATUS: Record<TicketStatus, string> = {
  received: "Needs attention",
  investigating: "Investigating",
  reported: "Report ready",
  resolved: "Resolved",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
        status === "reported" && "bg-signal-soft text-accent-foreground",
        status === "investigating" && "bg-muted text-foreground",
        status === "received" && "bg-sev-high/10 text-sev-high",
        status === "resolved" && "text-muted-foreground",
      )}
    >
      {status === "investigating" ? <span aria-hidden className="size-1.5 rounded-full bg-signal signal-pulse" /> : null}
      {TICKET_STATUS[status]}
    </span>
  );
}

export function investigationLabel(status: InvestigationStatus): string {
  return { queued: "Queued", running: "Running", done: "Done", failed: "Failed" }[status];
}
