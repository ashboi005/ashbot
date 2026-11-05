import type { AttachmentDto } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";

import { serverUrl } from "@/lib/api";

export function VoiceNote({ attachment, tone = "light", showOriginal = false }: { attachment: AttachmentDto; tone?: "light" | "dark"; showOriginal?: boolean }) {
  const english = attachment.transcriptEnglish;
  const original = attachment.transcript;
  return (
    <figure className="grid gap-2">
      <audio controls preload="none" src={serverUrl(attachment.url)} className={cn("h-9 w-64 max-w-full", tone === "dark" && "[color-scheme:dark]")}>
        <track kind="captions" />
      </audio>
      {english ? (
        <figcaption className="text-[14px] leading-relaxed">
          “{english}”
          {showOriginal && original && original !== english ? (
            <span className={cn("mt-1 block text-xs", tone === "dark" ? "text-primary-foreground/70" : "text-muted-foreground")}>Original: {original}</span>
          ) : null}
        </figcaption>
      ) : (
        <figcaption className={cn("text-xs", tone === "dark" ? "text-primary-foreground/70" : "text-muted-foreground")}>Voice note (no transcript)</figcaption>
      )}
    </figure>
  );
}
