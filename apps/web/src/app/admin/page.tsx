"use client";

import type { AdminTicketSummary } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/admin/admin-shell";
import { SeverityBadge, TicketStatusBadge } from "@/components/admin/badges";
import { relativeTime } from "@/lib/format";
import { useAdminTickets } from "@/lib/queries";

const TABS = [
  { id: "open", label: "Open", filter: (t: AdminTicketSummary) => t.status !== "resolved" },
  { id: "resolved", label: "Resolved", filter: (t: AdminTicketSummary) => t.status === "resolved" },
  { id: "all", label: "All", filter: () => true },
] as const;

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export default function InboxPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("open");
  const { data, isPending, error } = useAdminTickets();
  const active = TABS.find((t) => t.id === tab)!;
  const tickets = (data ?? []).filter(active.filter).sort((a, b) => {
    // Ready reports first, by severity; then everything else by recency.
    const aReady = a.status === "reported" ? 0 : 1;
    const bReady = b.status === "reported" ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    if (aReady === 0) return (SEVERITY_RANK[a.severity ?? "low"] ?? 3) - (SEVERITY_RANK[b.severity ?? "low"] ?? 3);
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return (
    <>
      <PageHeader title="Inbox" description="Reports from clients, with what the agent found." />
      <div className="flex gap-1 border-b px-6" role="tablist" aria-label="Filter tickets">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.id && "border-foreground font-medium text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{(data ?? []).filter(t.filter).length}</span>
          </button>
        ))}
      </div>
      {error ? <p className="px-6 py-6 text-sm text-destructive">{error.message}</p> : null}
      {!isPending && tickets.length === 0 && !error ? (
        <p className="px-6 py-10 text-sm text-muted-foreground">{tab === "open" ? "Nothing open. New client reports will show up here." : "No tickets here yet."}</p>
      ) : null}
      <ul className="divide-y">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link
              href={`/admin/tickets/${t.id}`}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5 outline-none hover:bg-muted/60 focus-visible:bg-muted"
            >
              <SeverityBadge severity={t.severity} />
              <span className="min-w-0">
                <span className="line-clamp-1 text-sm font-medium">{t.title}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  {t.authorName} · {t.projectName}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <TicketStatusBadge status={t.status} />
                <span className="hidden w-16 text-right text-xs text-muted-foreground sm:inline">{relativeTime(t.updatedAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
