import { defaultFetch, requestJson, type FetchFn } from "./http";

export type AxiomClient = {
  query(req: { apl: string; startTime: string; endTime: string }): Promise<Record<string, unknown>[]>;
};

type Table = { fields?: { name?: unknown }[]; columns?: unknown[][] };

export function tabularToRows(body: unknown): Record<string, unknown>[] {
  const tables = (body as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(tables)) return [];
  return (tables as Table[]).flatMap((table) => {
    const names = (table.fields ?? []).map((field) => String(field.name ?? ""));
    const columns = table.columns ?? [];
    const length = Math.max(0, ...columns.map((column) => (Array.isArray(column) ? column.length : 0)));
    return Array.from({ length }, (_, row) => Object.fromEntries(names.map((name, col) => [name, columns[col]?.[row]])));
  });
}

export function createAxiomClient(opts: { baseUrl: string; token: string; fetch?: FetchFn; timeoutMs?: number }): AxiomClient {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/v1/datasets/_apl?format=tabular`;
  const fetchFn = opts.fetch ?? defaultFetch;
  return {
    async query({ apl, startTime, endTime }) {
      const body = await requestJson(fetchFn, url, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
        body: JSON.stringify({ apl, startTime, endTime }),
        timeoutMs: opts.timeoutMs ?? 60_000,
      });
      return tabularToRows(body);
    },
  };
}
