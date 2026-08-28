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
 */

import { LessonPlayer } from "@/components/lessons/lesson-player";
import { PlayerControls } from "@/components/lessons/player-controls";
import { FlagLesson } from "@/components/lessons/flag-lesson";
import type { Cue } from "@/lib/lessons/cues";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

export function LessonView({
  lessonId,
  versionId,
  script,
  timeline,
  atVersionCap,
}: {
  lessonId: string;
  versionId: string;
  script: RenderableLessonScript;
  timeline: Cue[];
  atVersionCap: boolean;
}) {
  return (
    <LessonPlayer script={script} timeline={timeline}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <PlayerControls state={state} />
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
