import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStorage, createS3Storage } from "./storage";

describe("local storage", () => {
  test("round-trips bytes and has no direct URL", async () => {
    const storage = createLocalStorage(await mkdtemp(join(tmpdir(), "ashbot-")));
    await storage.put("tickets/a/b.png", new Uint8Array([1, 2, 3]), "image/png");
    expect([...(await storage.get("tickets/a/b.png"))]).toEqual([1, 2, 3]);
    expect(await storage.url("tickets/a/b.png")).toBeNull();
  });

  test("rejects keys that escape the storage directory", async () => {
    const storage = createLocalStorage(await mkdtemp(join(tmpdir(), "ashbot-")));
    await expect(storage.put("../evil", new Uint8Array([1]), "text/plain")).rejects.toThrow("Invalid storage key");
    await expect(storage.get("/etc/passwd")).rejects.toThrow("Invalid storage key");
  });
});

describe("s3 storage", () => {
  test("presigns a GET URL for the key without network access", async () => {
    const storage = createS3Storage({ bucket: "ashbot-attachments", region: "ap-south-1", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" });
    const url = await storage.url("tickets/t1/a.png");
    expect(url).toContain("ashbot-attachments");
    expect(url).toContain("tickets/t1/a.png");
    expect(url).toContain("X-Amz-Signature");
  });
});

describe("storageFromEnv", () => {
  test("uses S3 when a bucket is configured, local disk otherwise", async () => {
    const { storageFromEnv } = await import("./storage");
    const s3 = storageFromEnv({ S3_BUCKET: "b", S3_REGION: "ap-south-1", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }, "/tmp/x");
    expect(await s3.url("a")).toContain("X-Amz-Signature");
    const local = storageFromEnv({}, await mkdtemp(join(tmpdir(), "ashbot-")));
    expect(await local.url("a")).toBeNull();
  });

  test("refuses a half-configured bucket", async () => {
    const { storageFromEnv } = await import("./storage");
    expect(() => storageFromEnv({ S3_BUCKET: "b" }, "/tmp/x")).toThrow("S3_REGION");
  });
});
