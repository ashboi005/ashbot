import { expect, test } from "bun:test";

import { HttpError, requestJson } from "./http";

test("parses JSON bodies", async () => {
  const result = await requestJson(async () => new Response('{"a":1}', { status: 200 }), "https://x.example/a");
  expect(result).toEqual({ a: 1 });
});

test("returns null for empty bodies", async () => {
  expect(await requestJson(async () => new Response("", { status: 200 }), "https://x.example/a")).toBeNull();
});

test("throws HttpError with status for a non-JSON error page", async () => {
  const html = "<html><body>502 Bad Gateway</body></html>";
  const promise = requestJson(async () => new Response(html, { status: 502 }), "https://x.example/api/v1/apps?token=abc");
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  await expect(promise).rejects.toThrow("GET /api/v1/apps failed with 502");
});

test("throws a clear error when a 200 body is not JSON", async () => {
  const promise = requestJson(async () => new Response("<html>login</html>", { status: 200 }), "https://x.example/a");
  await expect(promise).rejects.toThrow("Expected JSON from GET /a");
});
