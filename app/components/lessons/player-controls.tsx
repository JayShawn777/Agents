"use client";

/**
 * AC 12's controls: pause, resume, step backward, step forward, replay.
 * M5 adds two more: mute (AC 16, session-only, no persistence) and a captions
 * toggle (AC 18, persisted per profile — the same PATCH shape as the persona
 * selection, AC 4).
 *
 * The transport controls stay purely presentational — every one of them calls
 * straight into the state the player already owns. Nothing here decides
 * anything about the lesson, which is what keeps AC 12's guarantee (backward
 * to step k equals forward to step k) a property of one fold rather than of
 * five handlers.
 *
 * The counter reads "Step 2 of 6" and never a percentage. It only counts UP,
 * and it names a boundary the child was told about — M2 AC 20's rule that a
 * child never sees a number that can fall does not stop applying because the
 * screen changed.
 *
 * **The captions toggle owns its own PATCH**, the same pattern
 * `regenerate-lesson-button.tsx` and `flag-lesson.tsx` already use for their
 * own endpoints — but unlike those, its result also has to be visible
 * elsewhere (`LessonCaptions`, rendered by a sibling, not a child, of this
 * component). So the boolean itself is CONTROLLED by the caller
 * (`captionsEnabled`/`onCaptionsChange`, owned by `LessonView`) while this
 * file owns the request that persists a change to it — an optimistic update
 * that reverts through the same callback on failure, so `LessonCaptions` and
 * this toggle can never show two different answers to "are captions on".
 */

import { useState, useTransition } from "react";
import { Captions, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { PlayerState } from "@/components/lessons/lesson-player";
import type { StudentProfileDTO } from "@/lib/schemas/dto";

export function PlayerControls({
  state,
  studentId,
  captionsEnabled,
  onCaptionsChange,
}: {
  state: PlayerState;
  studentId: string;
  captionsEnabled: boolean;
  onCaptionsChange: (enabled: boolean) => void;
}) {
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const [isSavingCaptions, startCaptionsTransition] = useTransition();

  function toggleCaptions() {
    const next = !captionsEnabled;
    setCaptionsError(null);
    onCaptionsChange(next); // optimistic — LessonCaptions updates immediately
    startCaptionsTransition(async () => {
      const result = await apiFetch<{ student: StudentProfileDTO }>(`/api/students/${studentId}`, {
        method: "PATCH",
        body: { captionsEnabled: next },
      });
      if (!result.ok) {
        setCaptionsError(result.error.message);
        onCaptionsChange(!next); // revert to what the server still has
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          // At the end, `play()` was a no-op: it sets `playRequested`, but
          // `isPlaying` is `playRequested && !atEnd`, so nothing moved. A child
          // who reached the last step and pressed the big primary button got
          // nothing at all. `replay` is the action the label already promised.
          onClick={state.isPlaying ? state.pause : state.atEnd ? state.replay : state.play}
          aria-label={state.isPlaying ? "Pause" : state.atEnd ? "Replay" : "Play"}
        >
          {state.isPlaying ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
          {/*
            The visible text must match the accessible name (WCAG 2.5.3, Label in
            Name): this said "Play" while announcing itself as "Replay".
          */}
          {state.isPlaying ? "Pause" : state.atEnd ? "Replay" : "Play"}
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

        {/* Muting is session-only — nothing here persists it, unlike captions. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={state.toggleMute}
          disabled={!state.hasAudio}
          aria-pressed={state.isMuted}
          aria-label={state.isMuted ? "Unmute" : "Mute"}
        >
          {state.isMuted ? (
            <VolumeX className="size-4" aria-hidden="true" />
          ) : (
            <Volume2 className="size-4" aria-hidden="true" />
          )}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={toggleCaptions}
          disabled={isSavingCaptions}
          aria-pressed={captionsEnabled}
          aria-label={captionsEnabled ? "Turn off captions" : "Turn on captions"}
        >
          <Captions className="size-4" aria-hidden="true" />
          Captions {captionsEnabled ? "on" : "off"}
        </Button>

        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          Step {state.stepIndex + 1} of {state.stepCount}
        </span>
      </div>

      {captionsError ? <p className="text-xs text-muted-foreground">{captionsError}</p> : null}
    </div>
  );
}
