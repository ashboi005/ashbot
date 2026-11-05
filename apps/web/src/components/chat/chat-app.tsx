"use client";

import type { Me, TicketSummary } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";
import { Menu, Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { FullPageMessage } from "@/components/full-page-message";
import { ApiRequestError } from "@/lib/api";
import { clientStatus, relativeTime } from "@/lib/format";
import { useCreateTicket, useMe, useSendMessage, useTicket, useTickets } from "@/lib/queries";

import { Composer } from "./composer";
import { MessageThread } from "./message-thread";
import { StatusTrack } from "./status-track";

export function ChatApp() {
  const router = useRouter();
  const { data: me, error } = useMe();

  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) router.replace("/login");
    if (me?.role === "admin") router.replace("/admin");
  }, [error, me, router]);

  if (error && !(error instanceof ApiRequestError && error.status === 401)) return <FullPageMessage title="Can't load your account">{error.message}</FullPageMessage>;
  if (!me || me.role === "admin") return <FullPageMessage title="Opening Ashbot…" />;
  if (me.projects.length === 0) {
    return (
      <FullPageMessage title="You're not linked to a project yet">
        Ask Ashwath to add you to your project, then refresh this page.
      </FullPageMessage>
    );
  }
  return <Chat me={me} />;
}

function Chat({ me }: { me: Me }) {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = me.projects.some((p) => p.id === params.get("project")) ? params.get("project")! : me.projects[0]!.id;
  const ticketId = params.get("t") ?? undefined;
  const [listOpen, setListOpen] = useState(false);
  const tickets = useTickets(projectId);

  function go(next: { project?: string; t?: string | null }) {
    const search = new URLSearchParams();
    search.set("project", next.project ?? projectId);
    const t = next.t === undefined ? ticketId : next.t;
    if (t) search.set("t", t);
    router.replace(`/chat?${search.toString()}`);
    setListOpen(false);
  }

  return (
    <div className="flex h-svh">
      {/* Conversation list: a column on desktop, a sheet on mobile */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-80 max-w-[85vw] flex-col border-r bg-card transition-transform duration-200 md:static md:translate-x-0",
          listOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <Brand />
          <button type="button" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setListOpen(false)} aria-label="Close conversations">
            <X className="size-4" />
          </button>
        </div>
        {me.projects.length > 1 ? (
          <div className="px-5 pb-3">
            <label htmlFor="project" className="sr-only">
              Project
            </label>
            <select
              id="project"
              value={projectId}
              onChange={(e) => go({ project: e.target.value, t: null })}
              className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {me.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="px-5 pb-3 text-sm text-muted-foreground">{me.projects[0]!.name}</p>
        )}
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => go({ t: null })}
            className={cn(
              "flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              !ticketId && "bg-muted",
            )}
          >
            <Plus className="size-4" /> New report
          </button>
        </div>
        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {tickets.data?.length ? (
            <ul className="grid gap-0.5">
              {tickets.data.map((t) => (
                <ConversationLink key={t.id} ticket={t} active={t.id === ticketId} onClick={() => go({ t: t.id })} />
              ))}
            </ul>
          ) : tickets.isPending ? null : (
            <p className="px-3 py-2 text-sm text-muted-foreground">Your reports will appear here.</p>
          )}
        </nav>
      </aside>
      {listOpen ? <button type="button" aria-label="Close conversations" className="fixed inset-0 z-20 bg-foreground/20 md:hidden" onClick={() => setListOpen(false)} /> : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 py-3 md:px-8">
          <button type="button" className="rounded-full p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setListOpen(true)} aria-label="Open conversations">
            <Menu className="size-5" />
          </button>
          <span className="flex-1" />
          <AccountMenu name={me.name} email={me.email} />
        </header>
        {ticketId ? (
          <Conversation key={ticketId} ticketId={ticketId} />
        ) : (
          <NewReport projectId={projectId} firstName={me.name.split(" ")[0] ?? me.name} onCreated={(id) => go({ t: id })} />
        )}
      </main>
    </div>
  );
}

function ConversationLink({ ticket, active, onClick }: { ticket: TicketSummary; active: boolean; onClick: () => void }) {
  const status = clientStatus(ticket.status);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn("grid w-full gap-0.5 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", active && "bg-muted")}
      >
        <span className="line-clamp-1 text-sm font-medium">{ticket.title}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", status.step === 3 ? "bg-muted-foreground/40" : "bg-signal", status.live && "signal-pulse")} />
          {status.label} · {relativeTime(ticket.updatedAt)}
        </span>
      </button>
    </li>
  );
}

function NewReport({ projectId, firstName, onCreated }: { projectId: string; firstName: string; onCreated: (ticketId: string) => void }) {
  const create = useCreateTicket();
  return (
    <div className="flex flex-1 flex-col justify-center px-4 pb-10 md:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-[clamp(1.75rem,3.5vw,2.5rem)] leading-tight font-semibold tracking-tight">What's going wrong, {firstName}?</h1>
        <p className="mt-3 mb-8 max-w-[52ch] text-[15px] text-muted-foreground">
          Describe it, attach a screenshot, or send a voice note. I'll start checking the system right away and reply here.
        </p>
        <Composer
          autoFocus
          placeholder="e.g. Customers can't check out since this morning, the button just spins"
          onSend={async (input) => {
            const ticket = await create.mutateAsync({ projectId, ...input });
            onCreated(ticket.id);
          }}
        />
      </div>
    </div>
  );
}

function Conversation({ ticketId }: { ticketId: string }) {
  const { data: ticket, error } = useTicket(ticketId);
  const send = useSendMessage(ticketId);

  if (error) return <p className="p-8 text-sm text-muted-foreground">{error.message}</p>;
  if (!ticket) return <div className="flex-1" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-8">
        <h1 className="line-clamp-2 text-lg font-semibold tracking-tight">{ticket.title}</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          {ticket.projectName} · opened {relativeTime(ticket.createdAt)}
        </p>
        <StatusTrack status={ticket.status} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          <MessageThread messages={ticket.messages} viewer="client" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-4 md:px-8 md:pb-6">
        <Composer placeholder="Add more detail…" onSend={async (input) => void (await send.mutateAsync(input))} />
      </div>
    </div>
  );
}
