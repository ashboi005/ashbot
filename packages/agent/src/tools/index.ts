import { createAwsReader, type AwsReader } from "@ashbot/integrations/aws";
import { createAxiomClient, type AxiomClient } from "@ashbot/integrations/axiom";
import { createCoolifyClient, type CoolifyClient } from "@ashbot/integrations/coolify";

import type { ProjectProfile } from "../profile";
import type { SnapshotStore } from "../snapshots";
import type { AnyTool } from "../tool";
import { awsTools } from "./aws";
import { axiomTools } from "./axiom";
import { coolifyTools } from "./coolify";

export type ToolDeps = { coolify?: CoolifyClient; axiom?: AxiomClient; aws?: AwsReader; snapshots: SnapshotStore };

export function buildProjectTools(profile: ProjectProfile, deps: ToolDeps): AnyTool[] {
  return [
    ...(profile.coolify && deps.coolify ? coolifyTools(profile.coolify, deps.coolify, deps.snapshots) : []),
    ...(profile.axiom && deps.axiom ? axiomTools(profile.axiom, deps.axiom, deps.snapshots) : []),
    ...(profile.aws && deps.aws ? awsTools(profile.aws, deps.aws, deps.snapshots) : []),
  ];
}

export function createProjectIntegrations(profile: ProjectProfile): Omit<ToolDeps, "snapshots"> {
  return {
    coolify: profile.coolify ? createCoolifyClient(profile.coolify) : undefined,
    axiom: profile.axiom ? createAxiomClient(profile.axiom) : undefined,
    aws: profile.aws ? createAwsReader(profile.aws) : undefined,
  };
}
