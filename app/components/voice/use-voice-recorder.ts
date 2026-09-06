"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * M6 AC 22 — **the only `getUserMedia` call in this application.**
 *
 * A static test (`tests/unit/components/voice/single-getusermedia.test.ts`)
 * reads the source tree and fails if a microphone is opened anywhere else. The
 * reason is not tidiness: every additional call site is a place a microphone can
 * be opened without the consent flow that makes opening it lawful, and a place
 * a stream can be left running. One call site means one place to audit and one
 * place that stops the tracks.
 *
 * **The stream is stopped on every exit path** — the effect cleanup, an error,
 * and the stop button — because a `MediaStreamTrack` left live keeps the
 * browser's recording indicator on and the microphone hot. A parent who
 * abandons this page mid-flow must not stay recorded.
 *
 * This hook owns capture and nothing else: no consent wording, no upload, no
 * step machine. It hands its caller a `Blob` and forgets it.
 *
 * A hook rather than a render-prop component, deliberately: a component that
 * called `children({ start, stop })` during render closes over refs at render
 * time, which React's own lint rule refuses — and it would be reaching for refs
 * to build a callback that only ever runs in an event handler.
 */

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "denied" | "unsupported";

export type UseVoiceRecorderOptions = {
  /** Called once per completed recording, with the captured audio. */
  onRecorded: (recording: { blob: Blob; durationMs: number }) => void;
  /** Hard stop, so a runaway recording cannot grow unbounded. */
  maxDurationMs: number;
};

export type VoiceRecorderApi = {
  state: RecorderState;
  elapsedMs: number;
  start: () => void;
  stop: () => void;
  errorMessage: string | null;
};

/** What `MediaRecorder` can actually produce here, best first. */
const PREFERRED_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function useVoiceRecorder({ onRecorded, maxDurationMs }: UseVoiceRecorderOptions): VoiceRecorderApi {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  /** Idempotent: called from the stop button, the error paths and unmount. */
  const releaseMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => releaseMicrophone, [releaseMicrophone]);

  const stop = useCallback(() => {
    // Stopping the RECORDER flushes the last chunk through `ondataavailable`
    // before `onstop`; releasing the stream first would truncate it.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    setErrorMessage(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !pickMimeType()) {
      setState("unsupported");
      setErrorMessage("This browser can't record audio. Try Chrome, Edge or Safari.");
      return;
    }

    setState("requesting");
    let stream: MediaStream;
    try {
      // ⚠️ THE ONLY getUserMedia CALL IN THE APPLICATION (AC 22). If you are
      // about to add another, add a prop to this component instead.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Deliberately one message for every failure: a denied permission and an
      // absent microphone are the same problem to the person reading it, and
      // the browser's own error text is not ours to surface.
      setState("denied");
      setErrorMessage("We couldn't use your microphone. Check your browser's microphone permission and try again.");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      chunksRef.current = [];
      releaseMicrophone();
      setState("stopped");
      onRecorded({ blob, durationMs });
    };

    startedAtRef.current = Date.now();
    recorder.start();
    setState("recording");
    setElapsedMs(0);
  }, [onRecorded, releaseMicrophone]);

  // The ticking clock, and the hard stop. Both live here rather than in the
  // caller so no step can forget the ceiling.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= maxDurationMs) stop();
    }, 200);
    return () => clearInterval(id);
  }, [state, maxDurationMs, stop]);

  return {
    state,
    elapsedMs,
    start: () => void start(),
    stop,
    errorMessage,
  };
}
