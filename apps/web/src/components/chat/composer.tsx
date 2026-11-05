"use client";

import type { AttachmentDto } from "@ashbot/contracts";
import { cn } from "@ashbot/ui/lib/utils";
import { ArrowUp, ImagePlus, Loader2, Mic, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { formatDuration } from "@/lib/format";
import { useUpload } from "@/lib/queries";

import { useRecorder } from "./use-recorder";

type Pending = {
  localId: string;
  kind: "image" | "audio";
  previewUrl: string;
  durationSec?: number;
  status: "uploading" | "done" | "error";
  attachment?: AttachmentDto;
  error?: string;
};

export function Composer({
  onSend,
  placeholder = "Describe what's going wrong…",
  autoFocus,
}: {
  onSend: (input: { body: string; attachmentIds: string[] }) => Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const upload = useUpload();
  const recorder = useRecorder();

  const uploading = pending.some((p) => p.status === "uploading");
  const ready = pending.filter((p) => p.status === "done");
  const canSend = !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  function update(localId: string, patch: Partial<Pending>) {
    setPending((items) => items.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));
  }

  async function addFile(file: File, kind: "image" | "audio", durationSec?: number) {
    const localId = crypto.randomUUID();
    setPending((items) => [...items, { localId, kind, previewUrl: URL.createObjectURL(file), durationSec, status: "uploading" }]);
    try {
      const attachment = await upload.mutateAsync(file);
      update(localId, { status: "done", attachment });
    } catch (err) {
      update(localId, { status: "error", error: err instanceof Error ? err.message : "Upload failed." });
    }
  }

  function remove(localId: string) {
    setPending((items) => {
      const item = items.find((i) => i.localId === localId);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return items.filter((i) => i.localId !== localId);
    });
  }

  async function startRecording() {
    await recorder.start();
  }

  async function finishRecording() {
    const seconds = recorder.seconds;
    const blob = await recorder.stop();
    if (!blob) return;
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    await addFile(new File([blob], `voice-note.${ext}`, { type: blob.type }), "audio", seconds);
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend({ body: text.trim(), attachmentIds: ready.map((p) => p.attachment!.id) });
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
      setText("");
      textarea.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send your message.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (recorder.state === "denied") toast.error("Microphone access is blocked. Allow it in your browser settings to send voice notes.");
  }, [recorder.state]);

  return (
    <div className="rounded-2xl border bg-card shadow-[0_1px_2px_rgb(24_33_58/0.04),0_8px_24px_-12px_rgb(24_33_58/0.12)] focus-within:border-signal/60">
      {pending.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attachments">
          {pending.map((item) => (
            <li key={item.localId} className="group relative">
              {item.kind === "image" ? (
                <div className={cn("size-16 overflow-hidden rounded-xl border bg-muted", item.status === "error" && "border-destructive")}>
                  <img src={item.previewUrl} alt="Attached screenshot" className={cn("size-full object-cover", item.status === "uploading" && "opacity-50")} />
                </div>
              ) : (
                <div className={cn("flex h-16 w-56 flex-col justify-center rounded-xl border bg-muted/60 px-3", item.status === "error" && "border-destructive")}>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Mic className="size-3.5 text-signal" /> Voice note {item.durationSec !== undefined ? `· ${formatDuration(item.durationSec)}` : ""}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {item.status === "uploading"
                      ? "Transcribing…"
                      : item.status === "error"
                        ? item.error
                        : item.attachment?.transcriptEnglish || "Saved. I'll listen to it."}
                  </span>
                </div>
              )}
              {item.status === "uploading" ? (
                <Loader2 className="absolute top-1 right-1 size-4 animate-spin text-muted-foreground" aria-label="Uploading" />
              ) : (
                <button
                  type="button"
                  onClick={() => remove(item.localId)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove attachment"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {recorder.state === "recording" ? (
        <div className="flex items-center gap-3 px-4 py-4" role="status" aria-live="polite">
          <span className="size-2.5 rounded-full bg-destructive signal-pulse" aria-hidden />
          <span className="text-sm font-medium tabular-nums">Recording {formatDuration(recorder.seconds)}</span>
          <span className="text-xs text-muted-foreground">up to {formatDuration(recorder.maxSeconds)}, Hindi or English is fine</span>
        </div>
      ) : (
        <textarea
          ref={textarea}
          value={text}
          autoFocus={autoFocus}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (images.length > 0) {
              e.preventDefault();
              images.forEach((file) => void addFile(file, "image"));
            }
          }}
          className="block max-h-56 min-h-14 w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      )}

      <div className="flex items-center gap-1 px-2 pb-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            [...(e.target.files ?? [])].forEach((file) => void addFile(file, "image"));
            e.target.value = "";
          }}
        />
        {recorder.state === "recording" ? (
          <>
            <ComposerIcon label="Discard recording" onClick={recorder.cancel}>
              <Trash2 />
            </ComposerIcon>
            <button
              type="button"
              onClick={() => void finishRecording()}
              className="ml-1 flex h-9 items-center gap-2 rounded-full bg-destructive/10 px-3 text-sm font-medium text-destructive outline-none hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square className="size-3.5 fill-current" /> Stop
            </button>
          </>
        ) : (
          <>
            <ComposerIcon label="Attach a screenshot" onClick={() => fileInput.current?.click()}>
              <ImagePlus />
            </ComposerIcon>
            <ComposerIcon
              label={recorder.state === "unsupported" ? "Voice notes aren't supported in this browser" : "Record a voice note"}
              disabled={recorder.state === "unsupported"}
              onClick={() => void startRecording()}
            >
              <Mic />
            </ComposerIcon>
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend || recorder.state === "recording"}
          aria-label="Send"
          className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-30"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function ComposerIcon({ label, children, ...props }: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-[18px]"
      {...props}
    >
      {children}
    </button>
  );
}
