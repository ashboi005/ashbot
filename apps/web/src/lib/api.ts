export const SERVER_URL = (process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Absolute URL for server paths such as /api/attachments/:id.
export function serverUrl(path: string): string {
  return path.startsWith("http") ? path : `${SERVER_URL}${path}`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(serverUrl(path), { ...init, headers, body, credentials: "include" });
  } catch {
    throw new ApiRequestError(0, "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiRequestError(res.status, message);
  }
  return data as T;
}
