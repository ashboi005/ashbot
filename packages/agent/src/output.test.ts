import { describe, expect, test } from "bun:test";

import { createRedactor, prepareOutput, truncate } from "./output";

describe("createRedactor", () => {
  const redact = createRedactor(["s3cr3t-known-value"]);

  test("replaces known secret values", () => {
    expect(redact("token is s3cr3t-known-value here")).toBe("token is [REDACTED] here");
  });

  test("ignores known secrets shorter than 6 chars", () => {
    expect(createRedactor(["abc"])("abc abc")).toBe("abc abc");
  });

  test("redacts AWS access key ids", () => {
    expect(redact("key AKIAABCDEFGHIJKLMNOP used")).toBe("key [REDACTED] used");
  });

  test("redacts passwords in connection URLs", () => {
    expect(redact("connect postgres://app:hunter2@db:5432/app failed")).toBe(
      "connect postgres://app:[REDACTED]@db:5432/app failed",
    );
  });

  test("redacts env-style secret assignments", () => {
    expect(redact("DATABASE_PASSWORD=hunter2 NODE_ENV=production")).toBe(
      "DATABASE_PASSWORD=[REDACTED] NODE_ENV=production",
    );
  });

  test("redacts JSON secret fields", () => {
    expect(redact('{"password":"hunter2","user":"bob"}')).toBe('{"password":"[REDACTED]","user":"bob"}');
  });

  test("redacts bearer tokens", () => {
    expect(redact("Authorization: Bearer abcdefgh12345678")).toBe("Authorization: Bearer [REDACTED]");
  });

  test("redacts private key blocks", () => {
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----";
    expect(redact(`key:\n${pem}\ndone`)).toBe("key:\n[REDACTED]\ndone");
  });

  test("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
    expect(redact(`cookie=${jwt}`)).toBe("cookie=[REDACTED]");
  });

  test("leaves ordinary log lines alone", () => {
    const line = "2026-09-29T10:00:00Z ERROR GET /api/orders 500 in 120ms";
    expect(redact(line)).toBe(line);
  });
});

describe("truncate", () => {
  test("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("cuts long text and says how much was dropped", () => {
    const out = truncate("x".repeat(100), 10);
    expect(out).toBe(`${"x".repeat(10)}\n…[truncated: 90 more bytes]`);
  });
});

describe("prepareOutput", () => {
  test("stringifies objects as pretty JSON", () => {
    const redact = createRedactor([]);
    expect(prepareOutput({ a: 1 }, { redact, maxBytes: 1000 })).toBe('{\n  "a": 1\n}');
  });

  test("redacts before truncating so a secret is never half-shown", () => {
    const redact = createRedactor(["supersecretvalue"]);
    const out = prepareOutput(`supersecretvalue ${"y".repeat(5000)}`, { redact, maxBytes: 100 });
    expect(out).not.toContain("supersecret");
    expect(out.startsWith("[REDACTED]")).toBe(true);
    expect(out).toContain("[truncated:");
  });

  test("renders undefined as null", () => {
    expect(prepareOutput(undefined, { redact: (s) => s, maxBytes: 100 })).toBe("null");
  });
});
