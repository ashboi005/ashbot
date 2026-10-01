import { expect, test } from "bun:test";

import { createDeepgramClient } from "./deepgram";
import type { FetchFn } from "./http";

test("sends audio to nova-3 multilingual and returns transcript with languages", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        results: {
          channels: [{ alternatives: [{ transcript: "checkout kaam nahi kar raha", languages: ["hi", "en"] }] }],
        },
      }),
      { status: 200 },
    );
  };
  const client = createDeepgramClient({ apiKey: "dg-key", fetch: fetchFn });
  const result = await client.transcribe(new Uint8Array([1, 2]), "audio/webm");

  expect(result).toEqual({ transcript: "checkout kaam nahi kar raha", languages: ["hi", "en"] });
  expect(calls[0]?.url).toBe("https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true");
  const headers = new Headers(calls[0]?.init?.headers);
  expect(headers.get("authorization")).toBe("Token dg-key");
  expect(headers.get("content-type")).toBe("audio/webm");
});

test("falls back to word languages and detected_language", async () => {
  const fetchFn: FetchFn = async () =>
    new Response(
      JSON.stringify({
        results: {
          channels: [
            {
              detected_language: "en",
              alternatives: [{ transcript: "hello", words: [{ word: "hello", language: "en" }, { word: "bhai", language: "hi" }] }],
            },
          ],
        },
      }),
    );
  const result = await createDeepgramClient({ apiKey: "k", fetch: fetchFn }).transcribe(new Uint8Array([1]), "audio/webm");
  expect(result.languages.sort()).toEqual(["en", "hi"]);
});

test("returns an empty transcript when nothing was heard", async () => {
  const fetchFn: FetchFn = async () => new Response(JSON.stringify({ results: { channels: [] } }));
  const result = await createDeepgramClient({ apiKey: "k", fetch: fetchFn }).transcribe(new Uint8Array([1]), "audio/webm");
  expect(result).toEqual({ transcript: "", languages: [] });
});
