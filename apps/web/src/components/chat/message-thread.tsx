"use client";

import type { AttachmentDto, MessageDto } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";
import { useEffect, useRef } from "react";

import { serverUrl } from "@/lib/api";

import { VoiceNote } from "./voice-note";

export function MessageThread({ messages, viewer }: { messages: MessageDto[]; viewer: "client" | "admin" }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      {messages.map((message) => (
        <ThreadMessage key={message.id} message={message} viewer={viewer} />
      ))}
      <div ref={end} />
    </div>
  );
}

function ThreadMessage({ message, viewer }: { message: MessageDto; viewer: "client" | "admin" }) {
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (message.kind === "system") {
    return (
      <p className="mx-auto flex max-w-md items-center gap-2 text-center text-sm text-muted-foreground">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-signal" />
        {message.body}
      </p>
    );
  }

  // "Mine" is the right-aligned dark bubble: the client's messages in their view, the engineer's in the admin view.
  const mine = viewer === "client" ? message.kind === "client" : message.kind === "admin";
  const images = message.attachments.filter((a) => a.kind === "image");
  const voice = message.attachments.filter((a) => a.kind === "audio");

  return (
    <div className={cn("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "grid max-w-[min(85%,36rem)] gap-3 rounded-2xl px-4 py-3",
          mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card text-card-foreground",
        )}
      >
        {message.body ? <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.body}</p> : null}
        {voice.map((a) => (
          <VoiceNote key={a.id} attachment={a} tone={mine ? "dark" : "light"} showOriginal={viewer === "admin"} />
        ))}
        {images.length > 0 ? <ImageGrid images={images} /> : null}
      </div>
      <span className="px-1 text-xs text-muted-foreground">
        {!mine ? `${message.authorName ?? (message.kind === "admin" ? "Ashwath" : "Client")} · ` : ""}
        {time}
      </span>
    </div>
  );
}

function ImageGrid({ images }: { images: AttachmentDto[] }) {
  return (
    <div className={cn("grid gap-2", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
      {images.map((image) => (
        <a key={image.id} href={serverUrl(image.url)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <img src={serverUrl(image.url)} alt="Screenshot from the client" className="max-h-72 w-full object-cover" loading="lazy" />
        </a>
      ))}
    </div>
  );
}
