"use client";

import type { InvestigationDto, Snapshot } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

import { snapshotIdsIn } from "@/lib/format";

import { investigationLabel, SeverityBadge } from "./badges";

export function ReportPanel({ investigations }: { investigations: InvestigationDto[] }) {
  const [selected, setSelected] = useState(0);
  const run = investigations[Math.min(selected, investigations.length - 1)];
  if (!run) return <p className="text-sm text-muted-foreground">No investigation yet.</p>;

  return (
    <section aria-label="Investigation" className="grid gap-6">
      {investigations.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Runs">
          {investigations.map((inv, index) => (
            <button
              key={inv.id}
              type="button"
              role="tab"
              aria-selected={index === selected}
              onClick={() => setSelected(index)}
              className={cn("h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted", index === selected && "bg-muted font-medium text-foreground")}
            >
              {index === 0 ? "Latest" : `Run ${investigations.length - index}`} · {investigationLabel(inv.status)}
            </button>
          ))}
        </div>
      ) : null}

      {run.status === "queued" || run.status === "running" ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed px-4 py-5 text-sm">
          <Loader2 className="size-4 animate-spin text-signal" />
          {run.status === "queued" ? "Waiting for the worker to pick this up…" : "The agent is checking logs and services…"}
        </div>
      ) : null}

      {run.status === "failed" ? (
        <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">The investigation failed</p>
            <p className="mt-1 text-muted-foreground">{run.error}</p>
          </div>
        </div>
      ) : null}

      {run.report ? (
        <>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <SeverityBadge severity={run.report.severity} />
              <span className="text-xs text-muted-foreground capitalize">{run.report.status}</span>
            </div>
            <h2 className="text-lg leading-snug font-semibold tracking-tight">{run.report.title}</h2>
          </div>

          <ol className="grid gap-3" aria-label="Hypotheses, most likely first">
            {run.report.hypotheses.length === 0 ? <li className="text-sm text-muted-foreground">No hypothesis. The agent couldn't pin it down.</li> : null}
            {run.report.hypotheses.map((h, index) => (
              <li key={index} className={cn("rounded-md border bg-card p-4", index === 0 && "border-l-[3px] border-l-signal")}>
                <p className="flex gap-2.5 text-[15px] leading-snug font-medium">
                  <span className="text-muted-foreground tabular-nums">{index + 1}</span>
                  {h.claim}
                </p>
                <div className="mt-3 grid gap-2 pl-5">
                  {h.evidence.map((e, i) => (
                    <Evidence key={i} text={e} snapshots={run.snapshots} />
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {run.report.nextSteps.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Next steps</h3>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                {run.report.nextSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {run.report.suggestedFix ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Suggested fix (not applied)</h3>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{run.report.suggestedFix}</pre>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Checked: {run.report.coverage.checked.join(", ") || "nothing"} · Not checked: {run.report.coverage.notChecked.join(", ") || "nothing"}
          </p>
        </>
      ) : null}

      {run.toolCalls.length > 0 ? <ToolTrail run={run} /> : null}

      <p className="text-xs text-muted-foreground">
        {run.model ?? "model unknown"}
        {run.usage ? ` · ${run.usage.promptTokens.toLocaleString()} in / ${run.usage.completionTokens.toLocaleString()} out tokens` : ""}
        {run.startedAt && run.finishedAt ? ` · ${Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)}s` : ""}
        {run.stopReason && run.stopReason !== "submitted" ? ` · stopped: ${run.stopReason.replace("_", " ")}` : ""}
      </p>
    </section>
  );
}

function Evidence({ text, snapshots }: { text: string; snapshots: Snapshot[] }) {
  const ids = snapshotIdsIn(text);
  const found = ids.map((id) => snapshots.find((s) => s.id === id)).filter((s): s is Snapshot => Boolean(s));
  const [open, setOpen] = useState<string | null>(null);
  const shown = found.find((s) => s.id === open);

  if (found.length === 0) return <code className="block rounded bg-muted px-2 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{text}</code>;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {text.replace(/\bsnap_\d+\b/g, "").trim() ? <span className="text-muted-foreground">{text}</span> : null}
        {found.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-expanded={open === s.id}
            onClick={() => setOpen(open === s.id ? null : s.id)}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium hover:bg-muted"
          >
            <ChevronRight className={cn("size-3 transition-transform", open === s.id && "rotate-90")} />
            {s.source} log
          </button>
        ))}
      </div>
      {shown ? (
        <figure className="overflow-hidden rounded-md border">
          <figcaption className="border-b bg-muted px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{shown.query}</figcaption>
          <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre">{shown.content || "(empty)"}</pre>
        </figure>
      ) : null}
    </div>
  );
}

function ToolTrail({ run }: { run: InvestigationDto }) {
  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        What the agent did
        <span className="text-xs font-normal text-muted-foreground">{run.toolCalls.length} steps</span>
      </summary>
      <ol className="divide-y border-t">
        {run.toolCalls.map((call, index) => (
          <li key={index}>
            <details className="group/call">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 text-xs">
                <span className="w-5 text-right text-muted-foreground tabular-nums">{index + 1}</span>
                <span className={cn("font-mono", call.isError && "text-destructive")}>{call.name}</span>
                <span className="ml-auto text-muted-foreground tabular-nums">{call.durationMs}ms</span>
              </summary>
              <div className="grid gap-2 px-4 pb-3 pl-12">
                <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]">{JSON.stringify(call.input, null, 2)}</pre>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{call.output}</pre>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
