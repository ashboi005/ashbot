import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

export const projectProfileSchema = z.object({
  id: slug,
  name: z.string().min(1),
  runbook: z.string().default(""),
  runbookFile: z.string().optional(),
  coolify: z
    .object({
      baseUrl: z.url(),
      token: z.string().min(1),
      apps: z.array(z.object({ name: slug, uuid: z.string().min(1) })).min(1),
    })
    .optional(),
  axiom: z
    .object({
      baseUrl: z.url().default("https://api.axiom.co"),
      token: z.string().min(1),
      datasets: z.array(z.string().min(1)).min(1),
    })
    .optional(),
  aws: z
    .object({
      region: z.string().min(1),
      accessKeyId: z.string().min(1),
      secretAccessKey: z.string().min(1),
      logGroups: z.array(z.string().min(1)).default([]),
      buckets: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});

export type ProjectProfile = z.infer<typeof projectProfileSchema>;

const profilesFileSchema = z.object({ projects: z.array(projectProfileSchema).min(1) });

export function parseProfiles(json: unknown): ProjectProfile[] {
  const result = profilesFileSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid projects file:\n${z.prettifyError(result.error)}`);
  const seen = new Set<string>();
  for (const project of result.data.projects) {
    if (seen.has(project.id)) throw new Error(`Duplicate project id "${project.id}"`);
    seen.add(project.id);
  }
  return result.data.projects;
}

export function findProject(profiles: ProjectProfile[], id: string): ProjectProfile {
  const project = profiles.find((p) => p.id === id);
  if (!project) throw new Error(`Unknown project "${id}". Known: ${profiles.map((p) => p.id).join(", ")}`);
  return project;
}

export function secretsOf(profile: ProjectProfile): string[] {
  return [
    profile.coolify?.token,
    profile.axiom?.token,
    profile.aws?.accessKeyId,
    profile.aws?.secretAccessKey,
  ].filter((value): value is string => typeof value === "string");
}
