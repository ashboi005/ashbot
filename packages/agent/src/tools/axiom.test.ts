import { describe, expect, test } from "bun:test";

import type { AxiomClient } from "@ashbot/integrations/axiom";

import { createSnapshotStore } from "../snapshots";
import { axiomTools } from "./axiom";

const cfg = { baseUrl: "https://api.axiom.co", token: "t", datasets: ["acme-api", "acme-web"] };

function setup(rows: Record<string, unknown>[] = [{ message: "boom" }]) {
  const queries: { apl: string; startTime: string; endTime: string }[] = [];
  const client: AxiomClient = {
    query: async (req) => {
      queries.push(req);
      return rows;
    },
  };
  const snapshots = createSnapshotStore({ redact: (s) => s });
  const [tool] = axiomTools(cfg, client, snapshots);
  if (!tool) throw new Error("no tool");
  return { tool, queries, snapshots };
}

const window = { startTime: "2026-09-29T00:00:00Z", endTime: "2026-09-29T12:00:00Z" };

describe("axiom_query", () => {
  test("prefixes the dataset and appends a limit", async () => {
    const { tool, queries } = setup();
    await tool.run({ dataset: "acme-api", pipeline: "| where level == 'error'", limit: 50, ...window });
    expect(queries[0]).toEqual({ apl: "['acme-api'] | where level == 'error' | limit 50", ...window });
  });

  test("accepts an empty pipeline", async () => {
    const { tool, queries } = setup();
    await tool.run({ dataset: "acme-api", pipeline: "", limit: 10, ...window });
    expect(queries[0]?.apl).toBe("['acme-api'] | limit 10");
  });

  test("only allows configured datasets", () => {
    const { tool } = setup();
    expect(tool.input.safeParse({ dataset: "other", ...window }).success).toBe(false);
  });

  test("rejects a pipeline that does not start with a pipe", async () => {
    const { tool } = setup();
    await expect(tool.run({ dataset: "acme-api", pipeline: "where x == 1", limit: 10, ...window })).rejects.toThrow("must start with '|'");
  });

  test("rejects references to other datasets", async () => {
    const { tool } = setup();
    await expect(tool.run({ dataset: "acme-api", pipeline: "| union ['secret-ds']", limit: 10, ...window })).rejects.toThrow(
      "can only query its own dataset",
    );
    await expect(tool.run({ dataset: "acme-api", pipeline: "| join kind=inner (x) on id", limit: 10, ...window })).rejects.toThrow(
      "can only query its own dataset",
    );
  });

  test("rejects an end time before the start time", async () => {
    const { tool } = setup();
    await expect(
      tool.run({ dataset: "acme-api", pipeline: "", limit: 10, startTime: "2026-09-29T12:00:00Z", endTime: "2026-09-29T00:00:00Z" }),
    ).rejects.toThrow("endTime must be after startTime");
  });

  test("rejects windows longer than 30 days", async () => {
    const { tool } = setup();
    await expect(
      tool.run({ dataset: "acme-api", pipeline: "", limit: 10, startTime: "2026-08-01T00:00:00Z", endTime: "2026-09-29T00:00:00Z" }),
    ).rejects.toThrow("at most 30 days");
  });

  test("saves rows as a snapshot and returns them", async () => {
    const { tool, snapshots } = setup([{ message: "boom" }, { message: "bang" }]);
    const result = (await tool.run({ dataset: "acme-api", pipeline: "", limit: 10, ...window })) as {
      snapshot: string;
      rowCount: number;
      rows: unknown[];
    };
    expect(result.snapshot).toBe("snap_1");
    expect(result.rowCount).toBe(2);
    expect(snapshots.all()[0]?.content).toBe('{"message":"boom"}\n{"message":"bang"}');
    expect(snapshots.all()[0]?.query).toContain("['acme-api']");
  });
});
