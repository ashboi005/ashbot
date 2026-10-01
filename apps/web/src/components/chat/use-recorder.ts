"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { pickRecorderMime } from "@/lib/format";

const MAX_SECONDS = 180;

export type RecorderState = "idle" | "recording" | "denied" | "unsupported";

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveStop = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const active = recorder.current;
        if (!active || active.state === "inactive") return resolve(null);
        resolveStop.current = resolve;
        active.stop();
      }),
    [],
  );

  const start = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("unsupported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    const mimeType = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => {
      const blob = chunks.current.length > 0 ? new Blob(chunks.current, { type: media.mimeType || mimeType || "audio/webm" }) : null;
      cleanup();
      setState("idle");
      resolveStop.current?.(blob);
      resolveStop.current = null;
    };
    recorder.current = media;
    media.start(250);
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) void stop();
        return s + 1;
      });
    }, 1000);
  }, [cleanup, stop]);

  const cancel = useCallback(() => {
    resolveStop.current = null;
    const active = recorder.current;
    if (active && active.state !== "inactive") {
      active.onstop = () => {
        cleanup();
        setState("idle");
      };
      active.stop();
    }
  }, [cleanup]);

  return { state, seconds, start, stop, cancel, maxSeconds: MAX_SECONDS };
}
