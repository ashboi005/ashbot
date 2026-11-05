import { z } from "zod";

import type { AxiomClient } from "@ashbot/integrations/axiom";

import type { ProjectProfile } from "../profile";
import type { SnapshotStore } from "../snapshots";
import { defineTool, type AnyTool } from "../tool";

type AxiomConfig = NonNullable<ProjectProfile["axiom"]>;

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const OTHER_DATASET = /\[\s*['"]|\b(union|join|lookup|externaldata)\b/i;

export function axiomTools(cfg: AxiomConfig, client: AxiomClient, snapshots: SnapshotStore): AnyTool[] {
  const datasets = cfg.datasets as [string, ...string[]];

  return [
    defineTool({
      name: "axiom_query",
      description:
        "Run an APL query on one of this project's Axiom datasets. Write only the pipeline after the dataset, starting with '|', e.g. \"| where level == 'error' | sort by _time desc\". Results are saved as a snapshot.",
      input: z.object({
        dataset: z.enum(datasets).describe(`One of: ${datasets.join(", ")}`),
        pipeline: z.string().max(2000).default("").describe("APL operators after the dataset, starting with '|'"),
        startTime: z.iso.datetime({ offset: true }).describe("ISO 8601 start of the time window"),
        endTime: z.iso.datetime({ offset: true }).describe("ISO 8601 end of the time window"),
        limit: z.int().min(1).max(200).default(100),
      }),
      run: async ({ dataset, pipeline, startTime, endTime, limit }) => {
        const trimmed = pipeline.trim();
        if (trimmed !== "" && !trimmed.startsWith("|")) throw new Error("pipeline must start with '|' (the dataset is added for you)");
        if (OTHER_DATASET.test(trimmed)) throw new Error("This tool can only query its own dataset; remove dataset references, union, join and lookup.");
        const start = Date.parse(startTime);
        const end = Date.parse(endTime);
        if (end <= start) throw new Error("endTime must be after startTime");
        if (end - start > MAX_WINDOW_MS) throw new Error("The time window can be at most 30 days (Axiom retention).");

        const apl = [`['${dataset}']`, trimmed, `| limit ${limit}`].filter(Boolean).join(" ");
        const rows = await client.query({ apl, startTime, endTime });
        const snapshot = snapshots.save({
          source: "axiom",
          query: `${apl} [${startTime} → ${endTime}]`,
          content: rows.map((row) => JSON.stringify(row)).join("\n"),
        });
        return { snapshot, rowCount: rows.length, rows };
      },
    }),
  ];
}
