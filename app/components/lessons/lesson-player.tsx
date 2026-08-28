"use client";

/**
 * The lesson player (M4 AC 11, 12, 15).
 *
 * **It owns one number: which step is showing.** Everything drawn is a pure
 * function of that — `Stage` renders the ops of steps 0..k folded in order — so
 * AC 12's "stepping backward to step k produces the same canvas as playing
 * forward to step k" is not a behaviour to implement and test, it is the same
 * computation reached two ways. There is no separate rewind path that could
 * disagree with the forward one.
 *
 * **It does not own the timeline.** Offsets come from an injected `CueSource`
 * (AC 7). M5 replaces that source with real narration timings and this file
 * does not change; if the player computed offsets from `durationMs` itself, M5
 * would be a rewrite. The spec says so in as many words.
 *
 * **AC 15** is honoured by *removing* the reveal transition, never by taking a
 * second rendering path — the final frame of a step is identical either way, so
 * a reduced-motion viewer sees the same lesson without the movement.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Stage } from "@/components/lessons/stage";
import { staticCueSource, type Cue } from "@/lib/lessons/cues";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

export function LessonPlayer({
  script,
  timeline,
  children,
}: {
  script: RenderableLessonScript;
  timeline: Cue[];
  /** The controls, rendered by the parent so this file owns state and not layout. */
  children?: (state: PlayerState) => React.ReactNode;
}) {
  const cueSourceRef = useRef(staticCueSource(timeline));
  const [stepIndex, setStepIndex] = useState(0);
  const [playRequested, setPlayRequested] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const lastIndex = Math.max(script.steps.length - 1, 0);
  const atEnd = stepIndex >= lastIndex;
  // DERIVED, not stored. Reaching the last step stops playback by arithmetic
  // rather than by an effect that watches `atEnd` and writes state back — which
  // is a cascading render, and which React's own lint rule is right to refuse.
  const isPlaying = playRequested && !atEnd;

  // Advance on the CURRENT step's duration, taken from the cue source. A single
  // timer per step rather than one clock for the whole lesson: a lesson paused
  // for a minute and resumed must continue from where it stopped, not jump to
  // where a wall clock says it should be.
  useEffect(() => {
    if (!isPlaying || atEnd) return;
    const cue = cueSourceRef.current.cues[stepIndex];
    const duration = cue?.durationMs ?? 0;
    const timer = setTimeout(() => setStepIndex((index) => Math.min(index + 1, lastIndex)), duration);
    return () => clearTimeout(timer);
  }, [isPlaying, stepIndex, atEnd, lastIndex]);

  const state: PlayerState = {
    stepIndex,
    stepCount: script.steps.length,
    isPlaying,
    atEnd,
    atStart: stepIndex === 0,
    narration: script.steps[stepIndex]?.narration ?? "",
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
      <Stage script={script} visibleStepCount={stepIndex + 1} reducedMotion={reducedMotion} />

      {/*
        The narration is rendered as text beside the canvas, not only spoken
        later by M5. A lesson has to be followable with the sound off — and in
        M4 there is no sound at all.
      */}
      <p className="min-h-[3rem] text-sm text-foreground" aria-live="polite">
        {state.narration}
      </p>

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
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  replay: () => void;
};

/**
 * AC 15. Watched rather than read once, because a viewer can change the system
 * setting while a lesson is open — someone who turns motion off part-way
 * through a lesson that is making them queasy should not have to reload.
 *
 * `useSyncExternalStore` rather than an effect that seeds state: a media query
 * IS external state, and subscribing to it directly avoids the render-then-
 * correct flash where the first paint animates and the second does not.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(REDUCED_MOTION_QUERY).matches : false),
    // Server snapshot: assume motion is fine, because the preference is a
    // client fact. The client corrects it on hydration.
    () => false,
  );
}
