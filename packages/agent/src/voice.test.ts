import { describe, expect, test } from "bun:test";

import type { LlmClient } from "./llm";
import { cleanTranscript, needsEnglishCleanup } from "./voice";

describe("needsEnglishCleanup", () => {
  test("is false for English-only speech", () => {
    expect(needsEnglishCleanup({ transcript: "The checkout page is broken", languages: ["en"] })).toBe(false);
    expect(needsEnglishCleanup({ transcript: "The checkout page is broken", languages: ["en-US"] })).toBe(false);
  });

  test("is true when another language was detected", () => {
    expect(needsEnglishCleanup({ transcript: "checkout kaam nahi kar raha", languages: ["hi", "en"] })).toBe(true);
  });

  test("is true for non-Latin script even without language info", () => {
    expect(needsEnglishCleanup({ transcript: "चेकआउट काम नहीं कर रहा", languages: [] })).toBe(true);
  });

  test("is false for an empty transcript", () => {
    expect(needsEnglishCleanup({ transcript: "", languages: ["hi"] })).toBe(false);
  });
});

describe("cleanTranscript", () => {
  test("asks the model for an English rewrite and returns its text", async () => {
    let seen: unknown;
    const llm: LlmClient = {
      async complete(req) {
        seen = req;
        return { message: { role: "assistant", content: "  The checkout is not working.  " }, usage: { promptTokens: 1, completionTokens: 1 } };
      },
    };
    expect(await cleanTranscript(llm, "checkout kaam nahi kar raha")).toBe("The checkout is not working.");
    const req = seen as { messages: { role: string; content: string }[]; tools: unknown[] };
    expect(req.tools).toEqual([]);
    expect(req.messages[0]?.role).toBe("system");
    expect(req.messages[1]?.content).toContain("checkout kaam nahi kar raha");
  });

  test("falls back to the original text if the model returns nothing", async () => {
    const llm: LlmClient = { complete: async () => ({ message: { role: "assistant", content: null }, usage: { promptTokens: 0, completionTokens: 0 } }) };
    expect(await cleanTranscript(llm, "original")).toBe("original");
  });
});
