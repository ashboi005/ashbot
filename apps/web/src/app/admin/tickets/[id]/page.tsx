"use client";

import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { TicketStatusBadge } from "@/components/admin/badges";
import { ReportPanel } from "@/components/admin/report-panel";
import { MessageThread } from "@/components/chat/message-thread";
import { PrimaryButton, QuietButton } from "@/components/field";
import { relativeTime } from "@/lib/format";
import { useAdminReply, useAdminTicket, useRerun, useSetStatus } from "@/lib/queries";

export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { data: ticket, error } = useAdminTicket(id);
  const reply = useAdminReply(id);
  const setStatus = useSetStatus(id);
  const rerun = useRerun(id);
  const [text, setText] = useState("");

  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (!ticket) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const running = ticket.investigations[0]?.status === "queued" || ticket.investigations[0]?.status === "running";

  async function sendReply() {
    if (!text.trim()) return;
    try {
      await reply.mutateAsync(text.trim());
      setText("");
      toast.success("Reply sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the reply.");
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b px-6 py-4">
        <Link href="/admin" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Inbox
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{ticket.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {ticket.author.name} ({ticket.author.email}) · {ticket.projectName} · opened {relativeTime(ticket.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TicketStatusBadge status={ticket.status} />
            <QuietButton disabled={running || rerun.isPending} onClick={() => rerun.mutate()}>
              {rerun.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Run again
            </QuietButton>
            {ticket.status === "resolved" ? (
              <QuietButton onClick={() => setStatus.mutate("received")}>Reopen</QuietButton>
            ) : (
              <PrimaryButton className="h-9" onClick={() => setStatus.mutate("resolved", { onSuccess: () => toast.success("Marked resolved") })}>
                Mark resolved
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section aria-label="Conversation" className="flex flex-col border-b lg:border-r lg:border-b-0">
          <div className="flex-1 px-6 py-6">
            <MessageThread messages={ticket.messages} viewer="admin" />
          </div>
          <div className="sticky bottom-0 border-t bg-background px-6 py-4">
            <label htmlFor="reply" className="sr-only">
              Reply to {ticket.author.name}
            </label>
            <textarea
              id="reply"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendReply();
              }}
              rows={3}
              placeholder={`Reply to ${ticket.author.name.split(" ")[0]}… they'll see this in their chat`}
              className="w-full resize-y rounded-md border bg-card px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">⌘ Enter to send</span>
              <PrimaryButton className="h-9" disabled={!text.trim() || reply.isPending} onClick={() => void sendReply()}>
                Send reply
              </PrimaryButton>
            </div>
          </div>
        </section>
        <div className="px-6 py-6">
          <ReportPanel key={ticket.investigations[0]?.id} investigations={ticket.investigations} />
        </div>
      </div>
    </div>
  );
}
