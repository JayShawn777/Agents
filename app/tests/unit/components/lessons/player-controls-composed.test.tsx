// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LessonPlayer } from "@/components/lessons/lesson-player";
import { PlayerControls } from "@/components/lessons/player-controls";
import type { Cue } from "@/lib/lessons/cues";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

/**
 * **`LessonPlayer` and `PlayerControls`, composed — which nothing else does.**
 *
 * The controls were only ever exercised against a hand-built `PlayerState` of
 * `vi.fn()`s, and the player file re-implemented its own miniature controls. So
 * every assertion about a control passed against a fake, and the seam between
 * the two was untested — which is exactly where a blocker was living: at the
 * end of a lesson the primary button called `play()`, but `isPlaying` is
 * `playRequested && !atEnd`, so pressing it did nothing at all while announcing
 * itself as "Replay". A child who reached the last step and pressed the big
 * button got silence.
 *
 * A mock cannot show that. Only the real pair can.
 */

const SCRIPT: RenderableLessonScript = {
  title: "Adding quarters",
  steps: [
    { id: "s1", narration: "First.", durationMs: 1000, ops: [] },
    { id: "s2", narration: "Second.", durationMs: 1000, ops: [] },
  ],
};

const TIMELINE: Cue[] = [
  { stepId: "s1", startOffsetMs: 0, durationMs: 1000 },
  { stepId: "s2", startOffsetMs: 1000, durationMs: 1000 },
];

function renderComposed() {
  return render(
    <LessonPlayer script={SCRIPT} timeline={TIMELINE}>
      {(state) => <PlayerControls state={state} />}
    </LessonPlayer>,
  );
}

describe("the player and its controls, together", () => {
  it("rewinds to the first step when the primary button is pressed at the end", () => {
    renderComposed();

    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));

    // The whole point: the button does something. Before the fix the counter
    // stayed on step 2, because `play()` cannot start a lesson already over.
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    // And `replay` starts playing, so the control is now a pause.
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  /**
   * WCAG 2.5.3 (Label in Name, level A): the accessible name must contain the
   * visible label. This button announced "Replay" while reading "Play", so a
   * speech-input user saying "click Replay" and a sighted user reading the
   * screen were looking at two different controls.
   */
  it("shows the same word it announces, at both ends of the lesson", () => {
    renderComposed();

    expect(screen.getByRole("button", { name: "Play" })).toHaveTextContent("Play");

    fireEvent.click(screen.getByRole("button", { name: "Next step" }));

    expect(screen.getByRole("button", { name: "Replay" })).toHaveTextContent("Replay");
  });
});
