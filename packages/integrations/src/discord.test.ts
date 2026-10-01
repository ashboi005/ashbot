import { expect, test } from "bun:test";

import { sendDiscordMessage } from "./discord";
import type { FetchFn } from "./http";

test("posts the message as JSON to the webhook", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };
  await sendDiscordMessage({ webhookUrl: "https://discord.com/api/webhooks/1/abc", fetch: fetchFn }, { content: "hi", embeds: [{ title: "T" }] });
  expect(calls[0]?.url).toBe("https://discord.com/api/webhooks/1/abc");
  expect(calls[0]?.init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ content: "hi", embeds: [{ title: "T" }], allowed_mentions: { parse: [] } });
});

test("throws with the status when Discord rejects the message", async () => {
  const fetchFn: FetchFn = async () => new Response("bad", { status: 400 });
  await expect(sendDiscordMessage({ webhookUrl: "https://discord.com/api/webhooks/1/abc", fetch: fetchFn }, { content: "x" })).rejects.toThrow("400");
});
