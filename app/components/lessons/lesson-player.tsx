"use client";

/**
 * The lesson player (M4 AC 11, 12, 15; M5 AC 13, 15, 16, 18).
 *
 * **It owns one number: which step is showing.** Everything drawn is a pure
 * function of that — `Stage` renders the ops of steps 0..k folded in order — so
 * AC 12's "stepping backward to step k produces the same canvas as playing
 * forward to step k" is not a behaviour to implement and test, it is the same
 * computation reached two ways. There is no separate rewind path that could
 * disagree with the forward one.
 *
 * **It does not own the timeline.** Offsets come from an injected `CueSource`
 * (AC 7) — `staticCueSource(timeline)` with no narration, `narrationCueSource
 * (narrationSteps)` (plan §4) once M5 narration is `READY`. The player's
 * `stepIndexAt`/`startOfStep` calls do not change either way, exactly as M4's
 * seam was built for.
 *
 * **Two M4 latent defects, fixed here because narration makes them reachable**
 * (both were carried as known-open in CLAUDE.md):
 *
 *   1. The cue source is now `useMemo`d over its real inputs rather than
 *      built once inside `useRef`'s initializer — which ran on every render
 *      and threw the result away, silently ignoring a `timeline` (or now a
 *      `narrationSteps`) prop that changed under the same mounted player.
 *   2. `stepIndex` now resets to 0 when `script` changes (compared inline
 *      during render, not in an effect — react-hooks/set-state-in-effect) — a
 *      regenerated lesson (a new `script` object from the server) used to
 *      leave a player showing step 4 of a script that might only have 2.
 *
 * **One `<audio>` element for the whole lesson** (plan §4, "the player,
 * precisely"), rendered but visually hidden — captions and the text view are
 * the followable-with-sound-off path, not audio controls. Its `src` is the
 * CURRENT step's signed URL; advancing sets `src` and calls `play()`, and
 * `onEnded` advances. AC 16's "no audio from a later step still playing" is
 * then structural: there is one element and one source, never two.
 *
 * **Drawing follows audio, never a second clock**, when narration is present.
 * The M4 `setTimeout` path survives only for the no-narration case (AC 17: no
 * narration at all, or a `FAILED` run) — the two advance mechanisms are
 * mutually exclusive, gated on `hasNarrationAudio`, so a lesson is never
 * driven by both at once.
 *
 * **AC 15** is honoured by *removing* the reveal transition (`stage.tsx`),
 * never by taking a second rendering path — the final frame of a step is
 * identical either way.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Stage } from "@/components/lessons/stage";
import { LessonCaptions } from "@/components/lessons/lesson-captions";
import { narrationCueSource, staticCueSource, type Cue } from "@/lib/lessons/cues";
import { NARRATION_URL_REFRESH_MARGIN_MS } from "@/lib/config";
import type { NarrationStepDTO, RenderableLessonScript } from "@/lib/schemas/dto";

export function LessonPlayer({
  script,
  timeline,
  narrationSteps = null,
  captionsEnabled,
  onNarrationStale,
  children,
}: {
  script: RenderableLessonScript;
  /** M4's authored-duration fallback. Always present; used whenever narration audio is not. */
  timeline: Cue[];
  /**
   * M5 AC 13. Present only once a narration run is `READY`. `null`/`undefined`
   * (no run, still generating, or `FAILED`) falls back to `timeline` — AC 17's
   * "the lesson still plays, silently, with captions".
   */
  narrationSteps?: NarrationStepDTO[] | null;
  /** Whether the caption line renders. Owned by the caller (persisted per profile, AC 18). */
  captionsEnabled: boolean;
  /**
   * Called at most once per narration payload, `NARRATION_URL_REFRESH_MARGIN_MS`
   * before the earliest `audioUrlExpiresAt`. The player has no route to call —
   * this is the caller's cue to re-fetch endpoint 47 and pass fresh
   * `narrationSteps` down.
   */
  onNarrationStale?: () => void;
  /** The controls, rendered by the parent so this file owns state and not layout. */
  children?: (state: PlayerState) => React.ReactNode;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [playRequested, setPlayRequested] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  // The "adjusting state during rendering" pattern (React's own docs), not an
  // effect: comparing against the LAST SEEN script and resetting inline, in
  // the render body, is what the lint rule (react-hooks/set-state-in-effect)
  // asks for in place of `useEffect(() => { setStepIndex(0) }, [script])` —
  // that version cascades an extra render on every script change. React
  // bails out of rendering children with the stale state when this branch
  // fires, so there is no flash of the old step at the new script's shape.
  const [scriptAtLastReset, setScriptAtLastReset] = useState(script);
  if (script !== scriptAtLastReset) {
    setScriptAtLastReset(script);
    setStepIndex(0);
    setPlayRequested(false);
  }
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The raw URL last written to the `<audio>` element — compared against
  // `step.audioUrl` rather than `audio.src` (a browser resolves the latter to
  // an absolute URL, which would never string-equal a relative one and would
  // restart playback on every unrelated re-render).
  const lastAudioUrlRef = useRef<string | null>(null);

  const lastIndex = Math.max(script.steps.length - 1, 0);
  const atEnd = stepIndex >= lastIndex;
  // DERIVED, not stored. Reaching the last step stops playback by arithmetic
  // rather than by an effect that watches `atEnd` and writes state back — which
  // is a cascading render, and which React's own lint rule is right to refuse.
  const isPlaying = playRequested && !atEnd;

  // Every script step must be narrated for audio to drive playback — a
  // partially-narrated run (which nothing today produces, but nothing proves
  // it never will) falls all the way back to the silent timer path rather
  // than mixing the two, which is simpler than a per-step fallback and matches
  // AC 17's actual shape (a run is READY or it is not).
  const hasNarrationAudio =
    narrationSteps !== null &&
    narrationSteps !== undefined &&
    narrationSteps.length === script.steps.length &&
    script.steps.every((step, index) => narrationSteps[index]?.stepId === step.id);

  const cueSource = useMemo(() => {
    if (hasNarrationAudio && narrationSteps) return narrationCueSource(narrationSteps);
    return staticCueSource(timeline);
  }, [hasNarrationAudio, narrationSteps, timeline]);

  // The M4 fallback: a single timer per step, taken from the cue source.
  // Gated OFF whenever narration audio is driving playback (below) — the two
  // must never both be advancing the same `stepIndex`.
  useEffect(() => {
    if (hasNarrationAudio || !isPlaying || atEnd) return;
    const cue = cueSource.cues[stepIndex];
    const duration = cue?.durationMs ?? 0;
    const timer = setTimeout(() => setStepIndex((index) => Math.min(index + 1, lastIndex)), duration);
    return () => clearTimeout(timer);
  }, [hasNarrationAudio, isPlaying, stepIndex, atEnd, lastIndex, cueSource]);

  // The audio element: set the current step's source and play/pause to match
  // `isPlaying`. `onEnded` (below) is what advances `stepIndex` in this mode.
  useEffect(() => {
    const audio = audioRef.current;
    if (!hasNarrationAudio || !audio || !narrationSteps) return;
    const step = narrationSteps[stepIndex];
    if (!step) return;

    if (lastAudioUrlRef.current !== step.audioUrl) {
      lastAudioUrlRef.current = step.audioUrl;
      audio.src = step.audioUrl;
    }

    if (isPlaying) {
      // Autoplay can be refused by the browser (no user activation, or a
      // `src` swap losing it — plan §8.2's open question). There is nothing
      // useful to do about a rejected promise here beyond not crashing: the
      // control still shows "Pause" until the child presses it again, and the
      // drawing for this step is already visible regardless of whether the
      // audio actually started.
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [hasNarrationAudio, narrationSteps, stepIndex, isPlaying]);

  function handleAudioEnded() {
    setStepIndex((index) => {
      if (index >= lastIndex) {
        setPlayRequested(false);
        return index;
      }
      return index + 1;
    });
  }

  // Signed-URL refresh (plan §4): schedule exactly one call to
  // `onNarrationStale`, timed to `NARRATION_URL_REFRESH_MARGIN_MS` before the
  // earliest `audioUrlExpiresAt` in the CURRENT payload. Re-scheduled whenever
  // `narrationSteps` changes — including after the caller refreshes it, so a
  // long lesson keeps renewing rather than firing once and going stale again.
  useEffect(() => {
    if (!hasNarrationAudio || !narrationSteps || !onNarrationStale) return;
    const earliestExpiryMs = Math.min(
      ...narrationSteps.map((step) => new Date(step.audioUrlExpiresAt).getTime()),
    );
    const delay = earliestExpiryMs - NARRATION_URL_REFRESH_MARGIN_MS - Date.now();
    if (delay <= 0) {
      onNarrationStale();
      return;
    }
    const timer = setTimeout(onNarrationStale, delay);
    return () => clearTimeout(timer);
  }, [hasNarrationAudio, narrationSteps, onNarrationStale]);

  const state: PlayerState = {
    stepIndex,
    stepCount: script.steps.length,
    isPlaying,
    atEnd,
    atStart: stepIndex === 0,
    narration: script.steps[stepIndex]?.narration ?? "",
    isMuted,
    hasAudio: hasNarrationAudio,
    toggleMute: () => setIsMuted((muted) => !muted),
    play: () => setPlayRequested(true),
    pause: () => setPlayRequested(false),
    next: () => {
      setPlayRequested(false);
      setStepIndex((index) => Math.min(index + 1, lastIndex));
    },
    previous: () => {
      setPlayRequested(false);
      setStepIndex((index) => Math.max(index - 1, 0));
    },
    replay: () => {
      setStepIndex(0);
      setPlayRequested(true);
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <Stage script={script} visibleStepCount={stepIndex + 1} />

      <audio ref={audioRef} muted={isMuted} onEnded={handleAudioEnded} className="hidden" aria-hidden="true" />

      <LessonCaptions narration={state.narration} stepIndex={stepIndex} enabled={captionsEnabled} />

      {children?.(state)}
    </div>
  );
}

export type PlayerState = {
  stepIndex: number;
  stepCount: number;
  isPlaying: boolean;
  atEnd: boolean;
  atStart: boolean;
  narration: string;
  isMuted: boolean;
  /** Whether THIS lesson's narration audio is actually driving playback right now. */
  hasAudio: boolean;
  toggleMute: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  replay: () => void;
};
