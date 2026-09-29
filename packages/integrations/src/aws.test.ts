import { expect, test } from "bun:test";

import { pickLambdaConfig } from "./aws";

test("pickLambdaConfig drops environment variables and unknown fields", () => {
  const raw = {
    FunctionName: "acme-worker",
    Runtime: "nodejs22.x",
    State: "Active",
    LastUpdateStatus: "Successful",
    LastModified: "2026-09-28T10:00:00Z",
    MemorySize: 512,
    Timeout: 30,
    Environment: { Variables: { DATABASE_URL: "postgres://a:b@c/d" } },
    KMSKeyArn: "arn:aws:kms:...",
  };
  expect(pickLambdaConfig(raw)).toEqual({
    FunctionName: "acme-worker",
    Runtime: "nodejs22.x",
    State: "Active",
    LastUpdateStatus: "Successful",
    LastModified: "2026-09-28T10:00:00Z",
    MemorySize: 512,
    Timeout: 30,
  });
});
