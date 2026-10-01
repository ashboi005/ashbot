import { describe, expect, test } from "bun:test";

import { clientStatus, formatDuration, pickRecorderMime, relativeTime, snapshotIdsIn, STATUS_STEPS } from "./format";

describe("clientStatus", () => {
  test("maps ticket status to the client's status track", () => {
    expect(STATUS_STEPS).toEqual(["Received", "Looking into it", "Reviewing", "Resolved"]);
    expect(clientStatus("received")).toEqual({ step: 0, label: "Received", live: false });
    expect(clientStatus("investigating")).toEqual({ step: 1, label: "Looking into it", live: true });
    expect(clientStatus("reported")).toEqual({ step: 2, label: "Reviewing", live: false });
    expect(clientStatus("resolved")).toEqual({ step: 3, label: "Resolved", live: false });
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  test("formats recent times compactly", () => {
    expect(relativeTime("2026-10-02T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-02T11:45:00Z", now)).toBe("15m ago");
    expect(relativeTime("2026-10-02T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-30T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("formatDuration", () => {
  test("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(75)).toBe("1:15");
  });
});

describe("snapshotIdsIn", () => {
  test("finds snapshot ids in evidence strings", () => {
    expect(snapshotIdsIn("snap_2")).toEqual(["snap_2"]);
    expect(snapshotIdsIn("see snap_1 and snap_12, line 4")).toEqual(["snap_1", "snap_12"]);
    expect(snapshotIdsIn("ERROR 500 /checkout")).toEqual([]);
  });
});

describe("pickRecorderMime", () => {
  test("prefers webm/opus, falls back to mp4 (Safari), else browser default", () => {
    expect(pickRecorderMime((t) => t === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime(() => false)).toBeUndefined();
  });
});
