import { defaultFetch, requestJson, type FetchFn } from "./http";

export type CoolifyClient = {
  getApplication(uuid: string): Promise<Record<string, unknown>>;
  getApplicationLogs(uuid: string, lines: number): Promise<string>;
  listDeployments(uuid: string, take: number): Promise<Record<string, unknown>[]>;
  getDeploymentLogs(deploymentUuid: string): Promise<string>;
  listEnvKeys(uuid: string): Promise<string[]>;
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export function formatDeploymentLogs(raw: unknown): string {
  if (typeof raw !== "string") return "";
  try {
    const entries: unknown = JSON.parse(raw);
    if (Array.isArray(entries)) {
      return entries
        .filter((entry): entry is Json => isObject(entry) && entry.hidden !== true)
        .map((entry) => `${String(entry.timestamp ?? "")} ${String(entry.output ?? "")}`.trim())
        .join("\n");
    }
  } catch {
    // Not JSON: fall through and return the raw text.
  }
  return raw;
}

export function createCoolifyClient(opts: { baseUrl: string; token: string; fetch?: FetchFn; timeoutMs?: number }): CoolifyClient {
  const base = `${opts.baseUrl.replace(/\/+$/, "")}/api/v1`;
  const fetchFn = opts.fetch ?? defaultFetch;
  const get = (path: string) =>
    requestJson(fetchFn, `${base}${path}`, {
      headers: { authorization: `Bearer ${opts.token}`, accept: "application/json" },
      timeoutMs: opts.timeoutMs,
    });
  const seg = encodeURIComponent;

  return {
    async getApplication(uuid) {
      const body = await get(`/applications/${seg(uuid)}`);
      return isObject(body) ? body : {};
    },
    async getApplicationLogs(uuid, lines) {
      const body = await get(`/applications/${seg(uuid)}/logs?lines=${lines}&show_timestamps=true`);
      return isObject(body) && typeof body.logs === "string" ? body.logs : "";
    },
    async listDeployments(uuid, take) {
      const body = await get(`/deployments/applications/${seg(uuid)}?take=${take}`);
      const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.deployments) ? body.deployments : [];
      return list.filter(isObject);
    },
    async getDeploymentLogs(deploymentUuid) {
      const body = await get(`/deployments/${seg(deploymentUuid)}`);
      return isObject(body) ? formatDeploymentLogs(body.logs) : "";
    },
    async listEnvKeys(uuid) {
      const body = await get(`/applications/${seg(uuid)}/envs`);
      if (!Array.isArray(body)) return [];
      return body.filter(isObject).flatMap((env) => (typeof env.key === "string" ? [env.key] : []));
    },
  };
}
