import { z } from "zod";

import type { AwsReader } from "@ashbot/integrations/aws";

import type { ProjectProfile } from "../profile";
import type { SnapshotStore } from "../snapshots";
import { defineTool, type AnyTool } from "../tool";

type AwsConfig = NonNullable<ProjectProfile["aws"]>;

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const isoTime = z.iso.datetime({ offset: true });

function window(startTime: string, endTime: string): { start: Date; end: Date } {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (end.getTime() <= start.getTime()) throw new Error("endTime must be after startTime");
  if (end.getTime() - start.getTime() > MAX_WINDOW_MS) throw new Error("The time window can be at most 30 days.");
  return { start, end };
}

export function awsTools(cfg: AwsConfig, reader: AwsReader, snapshots: SnapshotStore): AnyTool[] {
  const tools: AnyTool[] = [];

  if (cfg.logGroups.length > 0) {
    const groups = cfg.logGroups as [string, ...string[]];
    tools.push(
      defineTool({
        name: "aws_logs_filter",
        description: "Search a CloudWatch log group in a time window, optionally with a CloudWatch filter pattern (e.g. \"ERROR\"). Saved as a snapshot.",
        input: z.object({
          logGroupName: z.enum(groups).describe(`One of: ${groups.join(", ")}`),
          filterPattern: z.string().max(500).optional(),
          startTime: isoTime,
          endTime: isoTime,
          limit: z.int().min(1).max(200).default(100),
        }),
        run: async ({ logGroupName, filterPattern, startTime, endTime, limit }) => {
          const { start, end } = window(startTime, endTime);
          const events = await reader.filterLogEvents({ logGroupName, filterPattern, startTime: start, endTime: end, limit });
          const snapshot = snapshots.save({
            source: "aws",
            query: `logs ${logGroupName} "${filterPattern ?? ""}" [${startTime} → ${endTime}]`,
            content: events.map((e) => `${e.timestamp ?? ""} ${e.logStreamName ?? ""} ${e.message ?? ""}`.trim()).join("\n"),
          });
          return { snapshot, eventCount: events.length, events };
        },
      }),
    );
  }

  tools.push(
    defineTool({
      name: "aws_metric",
      description: "Read one CloudWatch metric over a time window (e.g. AWS/EC2 CPUUtilization for an instance).",
      input: z.object({
        namespace: z.string().min(1),
        metricName: z.string().min(1),
        dimensions: z.array(z.object({ name: z.string().min(1), value: z.string().min(1) })).max(10).default([]),
        stat: z.enum(["Average", "Sum", "Minimum", "Maximum", "SampleCount", "p90", "p99"]).default("Average"),
        periodSeconds: z.int().min(60).max(86_400).default(300),
        startTime: isoTime,
        endTime: isoTime,
      }),
      run: async ({ startTime, endTime, ...rest }) => {
        const { start, end } = window(startTime, endTime);
        return reader.getMetric({ ...rest, startTime: start, endTime: end });
      },
    }),
    defineTool({
      name: "aws_ec2_instances",
      description: "State, type and IPs of EC2 instances. Omit instanceIds to list all in the region.",
      input: z.object({ instanceIds: z.array(z.string().min(1)).max(20).optional() }),
      run: async ({ instanceIds }) => reader.describeInstances(instanceIds),
    }),
    defineTool({
      name: "aws_ecs_services",
      description: "Desired/running counts, deployments and recent events of ECS services.",
      input: z.object({ cluster: z.string().min(1), services: z.array(z.string().min(1)).min(1).max(10) }),
      run: async ({ cluster, services }) => reader.describeEcsServices(cluster, services),
    }),
    defineTool({
      name: "aws_lambda_config",
      description: "State, runtime, memory, timeout and last update status of a Lambda function (environment variables are never returned).",
      input: z.object({ functionName: z.string().min(1) }),
      run: async ({ functionName }) => reader.getLambdaConfig(functionName),
    }),
  );

  if (cfg.buckets.length > 0) {
    const buckets = cfg.buckets as [string, ...string[]];
    tools.push(
      defineTool({
        name: "aws_s3_list",
        description: "List object keys, sizes and dates in one of this project's S3 buckets (object contents are never read).",
        input: z.object({
          bucket: z.enum(buckets).describe(`One of: ${buckets.join(", ")}`),
          prefix: z.string().max(500).optional(),
          maxKeys: z.int().min(1).max(100).default(50),
        }),
        run: async ({ bucket, prefix, maxKeys }) => reader.listS3Objects(bucket, prefix, maxKeys),
      }),
    );
  }

  return tools;
}
