import { z } from "zod";

import type { CoolifyClient } from "@ashbot/integrations/coolify";

import type { ProjectProfile } from "../profile";
import type { SnapshotStore } from "../snapshots";
import { defineTool, type AnyTool } from "../tool";

type CoolifyConfig = NonNullable<ProjectProfile["coolify"]>;

const APP_FIELDS = ["name", "status", "fqdn", "git_repository", "git_branch", "git_commit_sha", "build_pack", "updated_at", "last_online_at"];
const DEPLOYMENT_FIELDS = ["deployment_uuid", "status", "commit", "commit_message", "created_at", "updated_at", "finished_at"];

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export function coolifyTools(cfg: CoolifyConfig, client: CoolifyClient, snapshots: SnapshotStore): AnyTool[] {
  const names = cfg.apps.map((app) => app.name) as [string, ...string[]];
  const appName = z.enum(names).describe(`One of this project's Coolify apps: ${names.join(", ")}`);
  const uuidOf = (name: string) => {
    const app = cfg.apps.find((a) => a.name === name);
    if (!app) throw new Error(`Unknown app "${name}"`);
    return app.uuid;
  };

  return [
    defineTool({
      name: "coolify_app_status",
      description: "Status, domains and currently deployed commit of this project's Coolify apps. Omit app to get all.",
      input: z.object({ app: appName.optional() }),
      run: async ({ app }) => {
        const selected = app ? [app] : names;
        return Promise.all(
          selected.map(async (name) => ({ app: name, ...pick(await client.getApplication(uuidOf(name)), APP_FIELDS) })),
        );
      },
    }),
    defineTool({
      name: "coolify_app_logs",
      description: "The last N lines of an app's container logs, with timestamps. Saved as a snapshot.",
      input: z.object({ app: appName, lines: z.int().min(1).max(1000).default(200) }),
      run: async ({ app, lines }) => {
        const content = await client.getApplicationLogs(uuidOf(app), lines);
        const snapshot = snapshots.save({ source: "coolify", query: `app logs ${app} (${lines} lines)`, content });
        return { snapshot, content };
      },
    }),
    defineTool({
      name: "coolify_deployments",
      description: "Recent deployments of an app: status, commit and timestamps. Use it to see what changed before the problem started.",
      input: z.object({ app: appName, take: z.int().min(1).max(20).default(5) }),
      run: async ({ app, take }) => (await client.listDeployments(uuidOf(app), take)).map((d) => pick(d, DEPLOYMENT_FIELDS)),
    }),
    defineTool({
      name: "coolify_deployment_logs",
      description: "Build and deploy logs of one of an app's recent deployments (get the id from coolify_deployments). Saved as a snapshot.",
      input: z.object({ app: appName, deploymentUuid: z.string().min(1) }),
      run: async ({ app, deploymentUuid }) => {
        const recent = await client.listDeployments(uuidOf(app), 50);
        if (!recent.some((d) => d.deployment_uuid === deploymentUuid)) {
          throw new Error(`Deployment "${deploymentUuid}" is not one of the recent deployments of app "${app}"`);
        }
        const content = await client.getDeploymentLogs(deploymentUuid);
        const snapshot = snapshots.save({ source: "coolify", query: `deployment logs ${app} ${deploymentUuid}`, content });
        return { snapshot, content };
      },
    }),
    defineTool({
      name: "coolify_env_names",
      description: "Names (never values) of an app's environment variables. Useful to see which services it is configured to use.",
      input: z.object({ app: appName }),
      run: async ({ app }) => ({ app, names: await client.listEnvKeys(uuidOf(app)) }),
    }),
  ];
}
