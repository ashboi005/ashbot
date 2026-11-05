import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import { DescribeServicesCommand, ECSClient } from "@aws-sdk/client-ecs";
import { GetFunctionConfigurationCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

export type AwsReader = {
  filterLogEvents(p: {
    logGroupName: string;
    filterPattern?: string;
    startTime: Date;
    endTime: Date;
    limit: number;
  }): Promise<{ timestamp?: string; logStreamName?: string; message?: string }[]>;
  getMetric(p: {
    namespace: string;
    metricName: string;
    dimensions: { name: string; value: string }[];
    stat: string;
    periodSeconds: number;
    startTime: Date;
    endTime: Date;
  }): Promise<{ timestamps: string[]; values: number[] }>;
  describeInstances(instanceIds?: string[]): Promise<Record<string, unknown>[]>;
  describeEcsServices(cluster: string, services: string[]): Promise<Record<string, unknown>[]>;
  getLambdaConfig(functionName: string): Promise<Record<string, unknown>>;
  listS3Objects(bucket: string, prefix: string | undefined, maxKeys: number): Promise<{ key?: string; size?: number; lastModified?: string }[]>;
};

const LAMBDA_FIELDS = ["FunctionName", "Runtime", "State", "StateReason", "LastUpdateStatus", "LastUpdateStatusReason", "LastModified", "MemorySize", "Timeout", "Handler", "Version"];

export function pickLambdaConfig(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(LAMBDA_FIELDS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
}

export function createAwsReader(opts: { region: string; accessKeyId: string; secretAccessKey: string }): AwsReader {
  const config = { region: opts.region, credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } };
  const logs = new CloudWatchLogsClient(config);
  const metrics = new CloudWatchClient(config);
  const ec2 = new EC2Client(config);
  const ecs = new ECSClient(config);
  const lambda = new LambdaClient(config);
  const s3 = new S3Client(config);

  return {
    async filterLogEvents({ logGroupName, filterPattern, startTime, endTime, limit }) {
      const out = await logs.send(
        new FilterLogEventsCommand({
          logGroupName,
          filterPattern,
          startTime: startTime.getTime(),
          endTime: endTime.getTime(),
          limit,
        }),
      );
      return (out.events ?? []).map((e) => ({
        timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : undefined,
        logStreamName: e.logStreamName,
        message: e.message,
      }));
    },
    async getMetric({ namespace, metricName, dimensions, stat, periodSeconds, startTime, endTime }) {
      const out = await metrics.send(
        new GetMetricDataCommand({
          StartTime: startTime,
          EndTime: endTime,
          MetricDataQueries: [
            {
              Id: "m1",
              MetricStat: {
                Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dimensions.map((d) => ({ Name: d.name, Value: d.value })) },
                Period: periodSeconds,
                Stat: stat,
              },
            },
          ],
        }),
      );
      const result = out.MetricDataResults?.[0];
      return { timestamps: (result?.Timestamps ?? []).map((t) => t.toISOString()), values: result?.Values ?? [] };
    },
    async describeInstances(instanceIds) {
      const out = await ec2.send(new DescribeInstancesCommand({ InstanceIds: instanceIds }));
      return (out.Reservations ?? []).flatMap((r) =>
        (r.Instances ?? []).map((i) => ({
          InstanceId: i.InstanceId,
          State: i.State?.Name,
          InstanceType: i.InstanceType,
          LaunchTime: i.LaunchTime?.toISOString(),
          PublicIpAddress: i.PublicIpAddress,
          PrivateIpAddress: i.PrivateIpAddress,
          Tags: i.Tags,
        })),
      );
    },
    async describeEcsServices(cluster, services) {
      const out = await ecs.send(new DescribeServicesCommand({ cluster, services }));
      return (out.services ?? []).map((s) => ({
        serviceName: s.serviceName,
        status: s.status,
        desiredCount: s.desiredCount,
        runningCount: s.runningCount,
        pendingCount: s.pendingCount,
        deployments: (s.deployments ?? []).map((d) => ({ status: d.status, rolloutState: d.rolloutState, createdAt: d.createdAt?.toISOString() })),
        events: (s.events ?? []).slice(0, 10).map((e) => ({ createdAt: e.createdAt?.toISOString(), message: e.message })),
      }));
    },
    async getLambdaConfig(functionName) {
      const out = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
      return pickLambdaConfig({ ...out });
    },
    async listS3Objects(bucket, prefix, maxKeys) {
      const out = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys }));
      return (out.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified?.toISOString() }));
    },
  };
}
