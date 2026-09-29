import { describe, expect, test } from "bun:test";

import { createCoolifyClient, formatDeploymentLogs } from "./coolify";
import type { FetchFn } from "./http";

function recordingFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchFn };
}

describe("createCoolifyClient", () => {
  test("fetches app logs with lines and timestamps, using the bearer token", async () => {
    const { calls, fetchFn } = recordingFetch({ logs: "line1\nline2" });
    const client = createCoolifyClient({ baseUrl: "https://coolify.example/", token: "tok", fetch: fetchFn });

    expect(await client.getApplicationLogs("app-1", 50)).toBe("line1\nline2");
    expect(calls[0]?.url).toBe("https://coolify.example/api/v1/applications/app-1/logs?lines=50&show_timestamps=true");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
  });

  test("URL-encodes path segments", async () => {
    const { calls, fetchFn } = recordingFetch({});
    const client = createCoolifyClient({ baseUrl: "https://coolify.example", token: "t", fetch: fetchFn });
    await client.getApplication("../servers");
    expect(calls[0]?.url).toBe("https://coolify.example/api/v1/applications/..%2Fservers");
  });

  test("lists deployments from either an array or a {deployments} object", async () => {
    const asArray = recordingFetch([{ deployment_uuid: "d1" }]);
    const asObject = recordingFetch({ count: 1, deployments: [{ deployment_uuid: "d2" }] });
    const a = createCoolifyClient({ baseUrl: "https://c.example", token: "t", fetch: asArray.fetchFn });
    const b = createCoolifyClient({ baseUrl: "https://c.example", token: "t", fetch: asObject.fetchFn });

    expect(await a.listDeployments("app-1", 5)).toEqual([{ deployment_uuid: "d1" }]);
    expect(await b.listDeployments("app-1", 5)).toEqual([{ deployment_uuid: "d2" }]);
    expect(asArray.calls[0]?.url).toBe("https://c.example/api/v1/deployments/applications/app-1?take=5");
  });

  test("returns env keys only, never values", async () => {
    const { fetchFn } = recordingFetch([
      { key: "DATABASE_URL", value: "postgres://a:b@c/d" },
      { key: "NODE_ENV", value: "production" },
    ]);
    const client = createCoolifyClient({ baseUrl: "https://c.example", token: "t", fetch: fetchFn });
    expect(await client.listEnvKeys("app-1")).toEqual(["DATABASE_URL", "NODE_ENV"]);
  });

  test("formats deployment logs from the deployment record", async () => {
    const logs = JSON.stringify([
      { output: "Building...", timestamp: "t1", hidden: false },
      { output: "secret build arg", timestamp: "t2", hidden: true },
      { output: "Done", timestamp: "t3" },
    ]);
    const { calls, fetchFn } = recordingFetch({ deployment_uuid: "d1", logs });
    const client = createCoolifyClient({ baseUrl: "https://c.example", token: "t", fetch: fetchFn });
    expect(await client.getDeploymentLogs("d1")).toBe("t1 Building...\nt3 Done");
    expect(calls[0]?.url).toBe("https://c.example/api/v1/deployments/d1");
  });
});

describe("formatDeploymentLogs", () => {
  test("returns raw text when logs are not JSON", () => {
    expect(formatDeploymentLogs("plain text")).toBe("plain text");
  });

  test("returns empty string for missing logs", () => {
    expect(formatDeploymentLogs(undefined)).toBe("");
  });
});
