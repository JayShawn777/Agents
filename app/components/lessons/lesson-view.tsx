"use client";

/**
 * The client half of the lesson page: the player, its controls, and the flag.
 *
 * **Why this file exists at all.** `LessonPlayer` exposes its state through a
 * render prop, and a server component cannot pass a function across the
 * boundary to a client one. So the composition lives here, in a client
 * component that takes plain serialisable data — and the page stays a server
 * component that renders the transcript-shaped things (the text view) itself.
 *
 * It also owns the one piece of state the flag needs and the player has: which
 * step was showing when the child pressed the button (AC 18).
 *
 * **M5 addition: it now owns `captionsEnabled`, mirrored for two siblings
 * that both need it** — `LessonPlayer` (renders `LessonCaptions`) and
 * `PlayerControls` (renders the toggle and owns the PATCH that persists it).
 * Neither is an ancestor of the other, so the boolean is lifted exactly one
 * level, here, rather than threaded through a context for a single value.
 */

import { useState } from "react";

import { LessonPlayer } from "@/components/lessons/lesson-player";
import { PlayerControls } from "@/components/lessons/player-controls";
import { FlagLesson } from "@/components/lessons/flag-lesson";
import type { Cue } from "@/lib/lessons/cues";
import type { NarrationStepDTO, RenderableLessonScript } from "@/lib/schemas/dto";

export function LessonView({
  lessonId,
  versionId,
  studentId,
  script,
  timeline,
  atVersionCap,
  narrationSteps = null,
  initialCaptionsEnabled,
  onNarrationStale,
}: {
  lessonId: string;
  versionId: string;
  studentId: string;
  script: RenderableLessonScript;
  timeline: Cue[];
  atVersionCap: boolean;
  narrationSteps?: NarrationStepDTO[] | null;
  /** From the profile's stored `captionsEnabled` (AC 18's ON-by-default). */
  initialCaptionsEnabled: boolean;
  onNarrationStale?: () => void;
}) {
  const [captionsEnabled, setCaptionsEnabled] = useState(initialCaptionsEnabled);

  return (
    <LessonPlayer
      script={script}
      timeline={timeline}
      narrationSteps={narrationSteps}
      captionsEnabled={captionsEnabled}
      onNarrationStale={onNarrationStale}
    >
      {(state) => (
        <div className="flex flex-col gap-4">
          <PlayerControls
            state={state}
            studentId={studentId}
            captionsEnabled={captionsEnabled}
            onCaptionsChange={setCaptionsEnabled}
          />
          <div className="flex flex-wrap items-center gap-2">
            <FlagLesson
              lessonId={lessonId}
              versionId={versionId}
              // The step showing right now, so a flag says "the bit where you
              // circled the four" rather than "somewhere in this lesson".
              stepIndex={state.stepIndex}
              atVersionCap={atVersionCap}
            />
          </div>
        </div>
      )}
    </LessonPlayer>
  );
}
