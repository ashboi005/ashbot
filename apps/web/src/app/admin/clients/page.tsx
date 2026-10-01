"use client";

import type { ClientDto, InviteDto, ProjectDto } from "@ashbot/contracts";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/admin-shell";
import { PrimaryButton, QuietButton, TextField } from "@/components/field";
import { relativeTime } from "@/lib/format";
import { useClients, useCreateInvite, useInvites, useProjects, useRevokeInvite, useSetClientProjects } from "@/lib/queries";

export default function ClientsPage() {
  const projects = useProjects();
  const clients = useClients();
  const invites = useInvites();
  const pending = (invites.data ?? []).filter((i) => !i.acceptedAt);

  return (
    <>
      <PageHeader title="Clients" description="Invite people from your clients' teams. Each person only sees their own reports." />
      <div className="grid gap-8 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-8">
          <section aria-label="Clients" className="grid gap-3">
            <h2 className="text-sm font-semibold">People</h2>
            {clients.data?.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet. Invite someone to get started.</p> : null}
            <ul className="divide-y rounded-md border bg-card">
              {clients.data?.map((c) => <ClientRow key={c.id} client={c} projects={projects.data ?? []} />)}
            </ul>
          </section>
          {pending.length > 0 ? (
            <section aria-label="Pending invites" className="grid gap-3">
              <h2 className="text-sm font-semibold">Pending invites</h2>
              <ul className="divide-y rounded-md border bg-card">
                {pending.map((i) => (
                  <InviteRow key={i.id} invite={i} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <InviteForm projects={projects.data ?? []} />
      </div>
    </>
  );
}

function ClientRow({ client, projects }: { client: ClientDto; projects: ProjectDto[] }) {
  const setProjects = useSetClientProjects();
  const assigned = new Set(client.projects.map((p) => p.id));
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{client.name}</span>
        <span className="block text-xs text-muted-foreground">{client.email}</span>
      </span>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
        <legend className="sr-only">Projects for {client.name}</legend>
        {projects.map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--signal)]"
              checked={assigned.has(p.id)}
              disabled={setProjects.isPending}
              onChange={(e) => {
                const next = new Set(assigned);
                if (e.target.checked) next.add(p.id);
                else next.delete(p.id);
                setProjects.mutate({ id: client.id, projectIds: [...next] }, { onError: (err) => toast.error(err.message) });
              }}
            />
            {p.name}
          </label>
        ))}
      </fieldset>
    </li>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <QuietButton
      className="h-8"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
    </QuietButton>
  );
}

function InviteRow({ invite }: { invite: InviteDto }) {
  const revoke = useRevokeInvite();
  const expired = Date.parse(invite.expiresAt) < Date.now();
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{invite.name}</span>
        <span className="block text-xs text-muted-foreground">
          {invite.email} · {expired ? "expired" : `sent ${relativeTime(invite.createdAt)}`}
        </span>
      </span>
      {!expired ? <CopyLink url={invite.url} /> : null}
      <QuietButton className="h-8 text-destructive hover:text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id)}>
        Revoke
      </QuietButton>
    </li>
  );
}

function InviteForm({ projects }: { projects: ProjectDto[] }) {
  const create = useCreateInvite();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [created, setCreated] = useState<InviteDto>();

  return (
    <section aria-label="Invite someone" className="h-fit rounded-md border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold">Invite someone</h2>
      {created ? (
        <div className="grid gap-3">
          <p className="text-sm">
            Send this link to <span className="font-medium">{created.name}</span>. It works once and expires in 7 days.
          </p>
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{created.url}</code>
          <div className="flex gap-2">
            <CopyLink url={created.url} />
            <QuietButton className="h-8" onClick={() => setCreated(undefined)}>
              Invite another
            </QuietButton>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { name, email, projectIds },
              {
                onSuccess: (invite) => {
                  setCreated(invite);
                  setName("");
                  setEmail("");
                  setProjectIds([]);
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Projects</legend>
            {projects.length === 0 ? <p className="text-sm text-muted-foreground">Add a project first.</p> : null}
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--signal)]"
                  checked={projectIds.includes(p.id)}
                  onChange={(e) => setProjectIds(e.target.checked ? [...projectIds, p.id] : projectIds.filter((id) => id !== p.id))}
                />
                {p.name}
              </label>
            ))}
          </fieldset>
          <PrimaryButton type="submit" disabled={create.isPending || projectIds.length === 0}>
            Create invite link
          </PrimaryButton>
        </form>
      )}
    </section>
  );
}
