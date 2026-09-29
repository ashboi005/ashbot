import { describe, expect, test } from "bun:test";

import { createAxiomClient, tabularToRows } from "./axiom";
import type { FetchFn } from "./http";

const tabular = {
  tables: [
    {
      name: "0",
      fields: [{ name: "_time" }, { name: "message" }],
      columns: [
        ["2026-09-29T10:00:00Z", "2026-09-29T10:01:00Z"],
        ["boom", "bang"],
      ],
    },
  ],
};

describe("tabularToRows", () => {
  test("converts column-major tables to rows", () => {
    expect(tabularToRows(tabular)).toEqual([
      { _time: "2026-09-29T10:00:00Z", message: "boom" },
      { _time: "2026-09-29T10:01:00Z", message: "bang" },
    ]);
  });

  test("returns [] for unexpected shapes", () => {
    expect(tabularToRows(null)).toEqual([]);
    expect(tabularToRows({ tables: "nope" })).toEqual([]);
  });
});

describe("createAxiomClient", () => {
  test("posts the APL query in tabular format", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(tabular), { status: 200 });
    };
    const client = createAxiomClient({ baseUrl: "https://api.axiom.co/", token: "xaat", fetch: fetchFn });
    const rows = await client.query({ apl: "['a'] | limit 1", startTime: "2026-09-29T00:00:00Z", endTime: "2026-09-29T12:00:00Z" });

    expect(rows).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://api.axiom.co/v1/datasets/_apl?format=tabular");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer xaat");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      apl: "['a'] | limit 1",
      startTime: "2026-09-29T00:00:00Z",
      endTime: "2026-09-29T12:00:00Z",
    });
  });
});
