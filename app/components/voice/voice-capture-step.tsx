"use client";

import { useEffect, useMemo, useState } from "react";
import { Mic, Square, RotateCcw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "@/components/voice/use-voice-recorder";

/**
 * M6 AC 9/10 — record, play back, re-record, then explicitly approve.
 *
 * **One component serves both the consent statement and the sample**, because
 * AC 10's rules are identical for the two and the only differences are wording
 * and duration bounds. Two components would be two places for "nothing is sent
 * until they approve" to drift apart, and that sentence is the requirement.
 *
 * **Nothing leaves the browser from here.** This step ends by handing its parent
 * a `Blob`; the upload lives in `voice-flow.tsx`. That is what makes AC 10's
 * "nothing is transmitted until they explicitly approve it" structural rather
 * than a promise — there is no network call in this file to accidentally fire.
 *
 * **Re-recording discards the previous take** (AC 10), including revoking its
 * object URL: a `blob:` URL that outlives its player keeps the audio alive in
 * memory for the life of the page.
 */

export type VoiceCaptureStepProps = {
  title: string;
  instructions: React.ReactNode;
  /** Rendered verbatim above the controls when the step has a script to read. */
  script?: readonly string[];
  minDurationMs: number;
  maxDurationMs: number;
  approveLabel: string;
  busy?: boolean;
  onApprove: (recording: { blob: Blob; durationMs: number }) => void;
};

function formatSeconds(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VoiceCaptureStep({
  title,
  instructions,
  script,
  minDurationMs,
  maxDurationMs,
  approveLabel,
  busy,
  onApprove,
}: VoiceCaptureStepProps) {
  const [recording, setRecording] = useState<{ blob: Blob; durationMs: number } | null>(null);

  // Derived during render rather than set from an effect: a `setState` in an
  // effect here would render once with a stale URL and once with the real one,
  // and React's own lint rule refuses it.
  const playbackUrl = useMemo(() => (recording ? URL.createObjectURL(recording.blob) : null), [recording]);

  useEffect(() => {
    if (!playbackUrl) return;
    // Revoked when the take is replaced or the step unmounts — an un-revoked
    // blob URL keeps a recording of a real person's voice resident for the life
    // of the page.
    return () => URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  const { state, elapsedMs, start, stop, errorMessage } = useVoiceRecorder({
    maxDurationMs,
    onRecorded: setRecording,
  });

  const tooShort = recording !== null && recording.durationMs < minDurationMs;

  return (
    <section aria-labelledby="voice-step-title" className="space-y-6">
      <div className="space-y-2">
        <h2 id="voice-step-title" className="text-xl font-semibold">
          {title}
        </h2>
        <div className="text-muted-foreground text-sm">{instructions}</div>
      </div>

      {script ? (
        <blockquote className="bg-muted/50 space-y-3 rounded-lg border p-4 text-base leading-relaxed">
          {script.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </blockquote>
      ) : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {state === "recording" ? (
            <Button type="button" variant="destructive" onClick={stop}>
              <Square aria-hidden="true" className="mr-2 size-4" />
              Stop recording
            </Button>
          ) : (
            <Button type="button" onClick={start} disabled={busy || state === "requesting"}>
              {recording ? (
                <RotateCcw aria-hidden="true" className="mr-2 size-4" />
              ) : (
                <Mic aria-hidden="true" className="mr-2 size-4" />
              )}
              {state === "requesting"
                ? "Waiting for the microphone…"
                : recording
                  ? "Record again"
                  : "Start recording"}
            </Button>
          )}

          {state === "recording" ? (
            <p aria-live="polite" className="text-muted-foreground text-sm tabular-nums">
              Recording {formatSeconds(elapsedMs)} — up to {formatSeconds(maxDurationMs)}
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {recording && playbackUrl ? (
        <div className="space-y-4 rounded-lg border p-4">
          <p className="text-sm font-medium">Listen back before you continue</p>
          {/* The parent's own voice, recorded seconds ago by them: there is no
              transcript to caption, and the words are on screen above. */}
          <audio controls src={playbackUrl} className="w-full" />

          {tooShort ? (
            <Alert variant="destructive">
              <AlertDescription>
                That recording is {formatSeconds(recording.durationMs)} long. Please record at least{" "}
                {formatSeconds(minDurationMs)}.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            onClick={() => onApprove(recording)}
            disabled={busy || tooShort}
          >
            {busy ? "Working…" : approveLabel}
          </Button>
          <p className="text-muted-foreground text-xs">
            Nothing is sent anywhere until you choose {`"${approveLabel}"`}.
          </p>
        </div>
      ) : null}
    </section>
  );
}
