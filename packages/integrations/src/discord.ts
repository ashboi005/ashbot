import { defaultFetch, type FetchFn } from "./http";

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
};

export async function sendDiscordMessage(
  opts: { webhookUrl: string; fetch?: FetchFn },
  message: { content?: string; embeds?: DiscordEmbed[] },
): Promise<void> {
  const fetchFn = opts.fetch ?? defaultFetch;
  const res = await fetchFn(opts.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Never ping @everyone or roles from agent-written text.
    body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Discord webhook failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
