import { expect, test } from "bun:test";

import { parseProfiles } from "../profile";
import { createSnapshotStore } from "../snapshots";
import { buildProjectTools } from "./index";

const [profile] = parseProfiles({
  projects: [
    {
      id: "acme",
      name: "Acme",
      coolify: { baseUrl: "https://c.example", token: "t", apps: [{ name: "api", uuid: "u" }] },
      axiom: { token: "t", datasets: ["acme"] },
    },
  ],
});

test("includes tools only for configured and provided integrations", () => {
  const snapshots = createSnapshotStore({ redact: (s) => s });
  const noop = async () => {
    throw new Error("not called");
  };
  const tools = buildProjectTools(profile!, {
    snapshots,
    coolify: { getApplication: noop, getApplicationLogs: noop, listDeployments: noop, getDeploymentLogs: noop, listEnvKeys: noop },
    axiom: { query: noop },
  });
  const names = tools.map((t) => t.name);
  expect(names).toContain("coolify_app_logs");
  expect(names).toContain("axiom_query");
  expect(names.some((n) => n.startsWith("aws_"))).toBe(false);
});
