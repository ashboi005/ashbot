import { describe, expect, test } from "bun:test";

import type { AwsReader } from "@ashbot/integrations/aws";

import { createSnapshotStore } from "../snapshots";
import type { AnyTool } from "../tool";
import { awsTools } from "./aws";

const baseCfg = { region: "ap-south-1", accessKeyId: "a", secretAccessKey: "s", logGroups: ["/aws/lambda/acme"], buckets: ["acme-uploads"] };

function fakeReader(calls: unknown[] = []): AwsReader {
  return {
    filterLogEvents: async (p) => {
      calls.push(p);
      return [{ timestamp: "2026-09-29T10:00:00.000Z", message: "ERROR timeout" }];
    },
    getMetric: async (p) => {
      calls.push(p);
      return { timestamps: ["t1"], values: [99] };
    },
    describeInstances: async (ids) => {
      calls.push(ids);
      return [{ InstanceId: "i-1", State: "running" }];
    },
    describeEcsServices: async () => [],
    getLambdaConfig: async () => ({ FunctionName: "acme", State: "Active" }),
    listS3Objects: async () => [{ key: "a.png", size: 10 }],
  };
}

const find = (tools: AnyTool[], name: string) => tools.find((t) => t.name === name);

describe("awsTools", () => {
  test("omits log and S3 tools when nothing is configured", () => {
    const tools = awsTools({ ...baseCfg, logGroups: [], buckets: [] }, fakeReader(), createSnapshotStore({ redact: (s) => s }));
    expect(find(tools, "aws_logs_filter")).toBeUndefined();
    expect(find(tools, "aws_s3_list")).toBeUndefined();
    expect(find(tools, "aws_ec2_instances")).toBeDefined();
  });

  test("logs filter only accepts configured log groups and passes Dates", async () => {
    const calls: unknown[] = [];
    const snapshots = createSnapshotStore({ redact: (s) => s });
    const tool = find(awsTools(baseCfg, fakeReader(calls), snapshots), "aws_logs_filter")!;
    expect(tool.input.safeParse({ logGroupName: "/other", startTime: "2026-09-29T00:00:00Z", endTime: "2026-09-29T01:00:00Z" }).success).toBe(false);

    const result = (await tool.run({
      logGroupName: "/aws/lambda/acme",
      filterPattern: "ERROR",
      startTime: "2026-09-29T00:00:00Z",
      endTime: "2026-09-29T01:00:00Z",
      limit: 50,
    })) as { snapshot: string; events: unknown[] };

    expect(calls[0]).toEqual({
      logGroupName: "/aws/lambda/acme",
      filterPattern: "ERROR",
      startTime: new Date("2026-09-29T00:00:00Z"),
      endTime: new Date("2026-09-29T01:00:00Z"),
      limit: 50,
    });
    expect(result.snapshot).toBe("snap_1");
    expect(snapshots.all()[0]?.content).toContain("ERROR timeout");
  });

  test("logs filter rejects bad windows", async () => {
    const tool = find(awsTools(baseCfg, fakeReader(), createSnapshotStore({ redact: (s) => s })), "aws_logs_filter")!;
    await expect(
      tool.run({ logGroupName: "/aws/lambda/acme", startTime: "2026-09-29T01:00:00Z", endTime: "2026-09-29T00:00:00Z", limit: 10 }),
    ).rejects.toThrow("endTime must be after startTime");
    await expect(
      tool.run({ logGroupName: "/aws/lambda/acme", startTime: "2026-07-01T00:00:00Z", endTime: "2026-09-29T00:00:00Z", limit: 10 }),
    ).rejects.toThrow("at most 30 days");
  });

  test("metric tool passes dimensions and period", async () => {
    const calls: unknown[] = [];
    const tool = find(awsTools(baseCfg, fakeReader(calls), createSnapshotStore({ redact: (s) => s })), "aws_metric")!;
    const result = await tool.run({
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: [{ name: "InstanceId", value: "i-1" }],
      stat: "Average",
      periodSeconds: 300,
      startTime: "2026-09-29T00:00:00Z",
      endTime: "2026-09-29T01:00:00Z",
    });
    expect(result).toEqual({ timestamps: ["t1"], values: [99] });
    expect(calls[0]).toMatchObject({ namespace: "AWS/EC2", periodSeconds: 300, stat: "Average" });
  });

  test("ec2 instances passes ids through", async () => {
    const calls: unknown[] = [];
    const tool = find(awsTools(baseCfg, fakeReader(calls), createSnapshotStore({ redact: (s) => s })), "aws_ec2_instances")!;
    expect(await tool.run({ instanceIds: ["i-1"] })).toEqual([{ InstanceId: "i-1", State: "running" }]);
    expect(calls[0]).toEqual(["i-1"]);
  });

  test("s3 list only accepts configured buckets", () => {
    const tool = find(awsTools(baseCfg, fakeReader(), createSnapshotStore({ redact: (s) => s })), "aws_s3_list")!;
    expect(tool.input.safeParse({ bucket: "someone-elses" }).success).toBe(false);
    expect(tool.input.safeParse({ bucket: "acme-uploads" }).success).toBe(true);
  });
});
