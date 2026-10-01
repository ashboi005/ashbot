import { defaultFetch, requestJson, type FetchFn } from "./http";

export type Transcription = { transcript: string; languages: string[] };

export type DeepgramClient = {
  transcribe(audio: Uint8Array, mimeType: string): Promise<Transcription>;
};

type Alternative = { transcript?: string; languages?: string[]; words?: { language?: string }[] };
type Channel = { detected_language?: string; alternatives?: Alternative[] };

export function createDeepgramClient(opts: { apiKey: string; fetch?: FetchFn; model?: string }): DeepgramClient {
  const fetchFn = opts.fetch ?? defaultFetch;
  const url = `https://api.deepgram.com/v1/listen?model=${opts.model ?? "nova-3"}&language=multi&smart_format=true`;

  return {
    async transcribe(audio, mimeType) {
      const body = (await requestJson(fetchFn, url, {
        method: "POST",
        headers: { authorization: `Token ${opts.apiKey}`, "content-type": mimeType },
        body: audio,
        timeoutMs: 120_000,
      })) as { results?: { channels?: Channel[] } } | null;

      const channel = body?.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];
      const languages = new Set<string>(alternative?.languages ?? []);
      if (languages.size === 0) {
        for (const word of alternative?.words ?? []) if (word.language) languages.add(word.language);
        if (channel?.detected_language) languages.add(channel.detected_language);
      }
      return { transcript: alternative?.transcript?.trim() ?? "", languages: [...languages] };
    },
  };
}
