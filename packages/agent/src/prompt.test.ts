import { describe, expect, test } from "bun:test";

import { buildSystemPrompt, buildTicketContent } from "./prompt";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt({ projectName: "Acme Portal", runbook: "API runs on app `api`." });

  test("names the project and includes the runbook", () => {
    expect(prompt).toContain("Acme Portal");
    expect(prompt).toContain("<runbook>\nAPI runs on app `api`.\n</runbook>");
  });

  test("states the rules that matter", () => {
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("at most two hypotheses");
    expect(prompt).toContain("submit_report");
    expect(prompt).toContain("snap_");
  });

  test("is deterministic (no timestamps), so it caches well", () => {
    expect(buildSystemPrompt({ projectName: "Acme Portal", runbook: "API runs on app `api`." })).toBe(prompt);
  });

  test("handles an empty runbook", () => {
    expect(buildSystemPrompt({ projectName: "X", runbook: "" })).toContain("<runbook>\n(no runbook yet)\n</runbook>");
  });
});

describe("buildTicketContent", () => {
  test("returns plain text when there are no images", () => {
    const content = buildTicketContent({
      text: "Checkout fails with a spinner",
      reportedAt: "2026-09-29T10:00:00.000Z",
      startedAt: "since this morning",
      images: [],
    });
    expect(typeof content).toBe("string");
    expect(content).toContain("<ticket>\nCheckout fails with a spinner\n</ticket>");
    expect(content).toContain("Reported at: 2026-09-29T10:00:00.000Z");
    expect(content).toContain("Client says it started: since this morning");
  });

  test("omits the started line when not given", () => {
    const content = buildTicketContent({ text: "x", reportedAt: "2026-09-29T10:00:00.000Z", images: [] });
    expect(content).not.toContain("started");
  });

  test("returns text + image parts when there are images", () => {
    const content = buildTicketContent({
      text: "See screenshot",
      reportedAt: "2026-09-29T10:00:00.000Z",
      images: ["data:image/png;base64,AAAA"],
    });
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0]?.type).toBe("text");
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });
});
