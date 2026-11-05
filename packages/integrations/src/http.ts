export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const defaultFetch: FetchFn = (input, init) => fetch(input, init);

export async function requestJson(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const { timeoutMs = 30_000, ...rest } = init;
  const method = rest.method ?? "GET";
  const path = new URL(url).pathname;
  const res = await fetchFn(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`);
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(res.status, `Expected JSON from ${method} ${path} but got: ${text.slice(0, 200)}`);
  }
}
