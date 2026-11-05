"use client";

import type { ProjectDto } from "@ashbot/contracts";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/admin-shell";
import { PrimaryButton, TextField } from "@/components/field";
import { useCreateProject, useProjects, useUpdateProject } from "@/lib/queries";

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export default function ProjectsPage() {
  const { data: projects, error } = useProjects();

  return (
    <>
      <PageHeader title="Projects" description="Each project's id must match its entry in projects.local.json, where its credentials live." />
      <div className="grid gap-8 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Projects" className="grid content-start gap-3">
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
          {projects?.length === 0 ? <p className="text-sm text-muted-foreground">No projects yet. Add your first one.</p> : null}
          {projects?.map((p) => <ProjectRow key={p.id} project={p} />)}
        </section>
        <NewProject />
      </div>
    </>
  );
}

function ProjectRow({ project }: { project: ProjectDto }) {
  const update = useUpdateProject();
  const [runbook, setRunbook] = useState(project.runbook);
  const dirty = runbook !== project.runbook;

  return (
    <details className="group rounded-md border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{project.name}</span>
          <span className="block font-mono text-xs text-muted-foreground">{project.slug}</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {project.memberCount} {project.memberCount === 1 ? "client" : "clients"} · {project.openTickets} open
        </span>
      </summary>
      <div className="grid gap-3 border-t px-4 py-4">
        <label htmlFor={`runbook-${project.id}`} className="text-sm font-medium">
          Runbook
        </label>
        <p className="-mt-2 text-xs text-muted-foreground">
          What the agent should know: what the product does, which app runs what, where the logs are, and known failure modes.
        </p>
        <textarea
          id={`runbook-${project.id}`}
          value={runbook}
          onChange={(e) => setRunbook(e.target.value)}
          rows={10}
          placeholder={"The API is the Coolify app `api`. Payments go through Stripe webhooks at /webhooks/stripe…"}
          className="w-full resize-y rounded-md border bg-background px-3 py-2.5 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <div className="flex justify-end">
          <PrimaryButton
            className="h-9"
            disabled={!dirty || update.isPending}
            onClick={() =>
              update.mutate(
                { id: project.id, runbook },
                { onSuccess: () => toast.success("Runbook saved"), onError: (err) => toast.error(err.message) },
              )
            }
          >
            Save runbook
          </PrimaryButton>
        </div>
      </div>
    </details>
  );
}

function NewProject() {
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState<string>();
  const effectiveSlug = slug ?? slugify(name);

  return (
    <section aria-label="Add a project" className="h-fit rounded-md border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold">Add a project</h2>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name, slug: effectiveSlug },
            {
              onSuccess: () => {
                toast.success("Project added");
                setName("");
                setSlug(undefined);
              },
              onError: (err) => toast.error(err.message),
            },
          );
        }}
      >
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Customer Portal" />
        <TextField
          label="Project id"
          required
          pattern="[a-z0-9][a-z0-9\-]*"
          value={effectiveSlug}
          onChange={(e) => setSlug(e.target.value)}
          hint="Lowercase letters, digits and dashes. Same as the id in projects.local.json."
        />
        <PrimaryButton type="submit" disabled={!name || !effectiveSlug || create.isPending}>
          Add project
        </PrimaryButton>
      </form>
    </section>
  );
}
