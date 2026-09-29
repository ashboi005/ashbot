import { expect, test } from "bun:test";

import { createRedactor } from "./output";
import { createSnapshotStore } from "./snapshots";

test("assigns sequential ids and keeps full content", () => {
  const store = createSnapshotStore({ redact: (s) => s, now: () => new Date("2026-09-29T10:00:00Z") });
  const big = "line\n".repeat(100_000);
  expect(store.save({ source: "coolify", query: "logs api", content: big })).toBe("snap_1");
  expect(store.save({ source: "axiom", query: "q", content: "x" })).toBe("snap_2");
  const all = store.all();
  expect(all).toHaveLength(2);
  expect(all[0]).toEqual({
    id: "snap_1",
    source: "coolify",
    query: "logs api",
    content: big,
    capturedAt: "2026-09-29T10:00:00.000Z",
  });
});

test("redacts content and query before storing", () => {
  const store = createSnapshotStore({ redact: createRedactor(["hunter2hunter2"]) });
  store.save({ source: "coolify", query: "pw hunter2hunter2", content: "DATABASE_URL=postgres://a:hunter2hunter2@db/x" });
  const [snap] = store.all();
  expect(snap?.query).toBe("pw [REDACTED]");
  expect(snap?.content).not.toContain("hunter2");
});

test("all() returns a copy", () => {
  const store = createSnapshotStore({ redact: (s) => s });
  store.save({ source: "a", query: "b", content: "c" });
  store.all().pop();
  expect(store.all()).toHaveLength(1);
});
