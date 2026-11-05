import type { Redactor } from "./output";

export type Snapshot = {
  id: string;
  source: string;
  query: string;
  content: string;
  capturedAt: string;
};

export type SnapshotStore = {
  save(input: { source: string; query: string; content: string }): string;
  all(): Snapshot[];
};

export function createSnapshotStore(opts: { redact: Redactor; now?: () => Date }): SnapshotStore {
  const items: Snapshot[] = [];
  const now = opts.now ?? (() => new Date());

  return {
    save({ source, query, content }) {
      const id = `snap_${items.length + 1}`;
      items.push({
        id,
        source,
        query: opts.redact(query),
        content: opts.redact(content),
        capturedAt: now().toISOString(),
      });
      return id;
    },
    all: () => [...items],
  };
}
