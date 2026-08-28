"use client";

/**
 * AC 12's controls: pause, resume, step backward, step forward, replay.
 *
 * Purely presentational — every one of these calls straight into the state the
 * player already owns. Nothing here decides anything about the lesson, which is
 * what keeps AC 12's guarantee (backward to step k equals forward to step k) a
 * property of one fold rather than of five handlers.
 *
 * The counter reads "Step 2 of 6" and never a percentage. It only counts UP,
 * and it names a boundary the child was told about — M2 AC 20's rule that a
 * child never sees a number that can fall does not stop applying because the
 * screen changed.
 */

import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlayerState } from "@/components/lessons/lesson-player";

export function PlayerControls({ state }: { state: PlayerState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        onClick={state.isPlaying ? state.pause : state.play}
        aria-label={state.isPlaying ? "Pause" : state.atEnd ? "Replay" : "Play"}
      >
        {state.isPlaying ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        {state.isPlaying ? "Pause" : "Play"}
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={state.previous}
        disabled={state.atStart}
        aria-label="Previous step"
      >
        <SkipBack className="size-4" aria-hidden="true" />
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={state.next}
        disabled={state.atEnd}
        aria-label="Next step"
      >
        <SkipForward className="size-4" aria-hidden="true" />
      </Button>

      <Button type="button" size="sm" variant="ghost" onClick={state.replay} aria-label="Start again">
        <RotateCcw className="size-4" aria-hidden="true" />
        Start again
      </Button>

      <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
        Step {state.stepIndex + 1} of {state.stepCount}
      </span>
    </div>
  );
}
