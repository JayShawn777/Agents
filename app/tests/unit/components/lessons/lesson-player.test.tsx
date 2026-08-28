// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { LessonPlayer } from "@/components/lessons/lesson-player";
import type { Cue } from "@/lib/lessons/cues";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

/**
 * `components/lessons/lesson-player.tsx` and `stage.tsx`.
 *
 * **What jsdom can and cannot check here, stated so nobody mistakes a green run
 * for a rendered lesson.** jsdom performs no layout: every
 * `getBoundingClientRect` returns zeros. The Stage deliberately draws no
 * annotation whose target measured to nothing, so in this environment the SVG
 * overlay is legitimately empty. That is the honest state, not a bug — and it
 * is why the geometry itself is a pure module with its own unit tests
 * (`tests/unit/lib/lessons/layout.test.ts`), and why the real drawing is
 * checked in a browser by slice 9's Playwright pass.
 *
 * What IS checkable here is the part that owns the acceptance criteria: the
 * fold over steps (AC 12) and the controls. AC 15 (reduced motion) is NOT
 * checked here and no longer can be — see the note at the foot of this file.
 */

const SCRIPT: RenderableLessonScript = {
  title: "Adding quarters",
  steps: [
    {
      id: "s1",
      narration: "We start with one quarter plus one quarter.",
      durationMs: 4_000,
      ops: [
        { kind: "write", id: "sum", latex: "x", latexHtml: "<span>sum-html</span>", at: { x: 0.5, y: 0.3 }, size: "lg" },
      ],
    },
    {
      id: "s2",
      narration: "The bottom number stays the same.",
      durationMs: 5_000,
      ops: [
        { kind: "label", id: "hint", text: "denominators match", at: { x: 0.5, y: 0.5 } },
        { kind: "circle", id: "ring", target: "sum" },
      ],
    },
    {
      id: "s3",
      narration: "So the answer is two quarters.",
      durationMs: 3_000,
      ops: [
        { kind: "write", id: "answer", latex: "y", latexHtml: "<span>answer-html</span>", at: { x: 0.5, y: 0.7 }, size: "lg" },
      ],
    },
  ],
};

const TIMELINE: Cue[] = [
  { stepId: "s1", startOffsetMs: 0, durationMs: 4_000 },
  { stepId: "s2", startOffsetMs: 4_000, durationMs: 5_000 },
  { stepId: "s3", startOffsetMs: 9_000, durationMs: 3_000 },
];

/**
 * Timer advances must run inside `act`, or React never flushes the state update
 * the timer caused and the assertion reads a stale DOM — the failure looks like
 * "the player did not advance" when in fact the test did not let it.
 */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Minimal controls, so the test drives the player through its real state API. */
function controls(state: {
  isPlaying: boolean;
  atEnd: boolean;
  atStart: boolean;
  stepIndex: number;
  stepCount: number;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  replay: () => void;
}) {
  return (
    <div>
      <span data-testid="position">{`${state.stepIndex + 1} of ${state.stepCount}`}</span>
      <button onClick={state.isPlaying ? state.pause : state.play}>{state.isPlaying ? "Pause" : "Play"}</button>
      <button onClick={state.previous} disabled={state.atStart}>
        Back
      </button>
      <button onClick={state.next} disabled={state.atEnd}>
        Forward
      </button>
      <button onClick={state.replay}>Replay</button>
    </div>
  );
}

const renderPlayer = () =>
  render(
    <LessonPlayer script={SCRIPT} timeline={TIMELINE}>
      {controls}
    </LessonPlayer>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the fold over steps (AC 12)", () => {
  it("starts on step 1 and shows only that step's work", () => {
    renderPlayer();

    expect(screen.getByTestId("position")).toHaveTextContent("1 of 3");
    expect(screen.getByText("sum-html")).toBeInTheDocument();
    expect(screen.queryByText("denominators match")).not.toBeInTheDocument();
    expect(screen.queryByText("answer-html")).not.toBeInTheDocument();
  });

  /**
   * "Build up" is the design: by the last step a child sees the whole method at
   * once, the way a worked example looks in an exercise book. Step 3 must not
   * replace steps 1 and 2.
   */
  it("accumulates rather than replaces as it advances", () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    expect(screen.getByText("sum-html")).toBeInTheDocument();
    expect(screen.getByText("denominators match")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByText("sum-html")).toBeInTheDocument();
    expect(screen.getByText("denominators match")).toBeInTheDocument();
    expect(screen.getByText("answer-html")).toBeInTheDocument();
  });

  /**
   * THE criterion. Stepping backward to step k must produce the same canvas as
   * playing forward to k. It does here because both are the same computation —
   * the canvas is a fold over steps 0..k and there is no separate rewind path
   * that could disagree.
   */
  it("renders the same canvas whether step 2 is reached forwards or backwards", () => {
    const forward = renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    const reachedForwards = forward.container.querySelector('[role="img"]')!.innerHTML;
    forward.unmount();

    const backward = renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const reachedBackwards = backward.container.querySelector('[role="img"]')!.innerHTML;

    expect(reachedBackwards).toBe(reachedForwards);
  });

  it("clamps at both ends rather than running off the script", () => {
    renderPlayer();

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByTestId("position")).toHaveTextContent("3 of 3");
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("replays from the beginning", () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));

    expect(screen.getByTestId("position")).toHaveTextContent("1 of 3");
    expect(screen.queryByText("answer-html")).not.toBeInTheDocument();
  });
});

describe("playback", () => {
  /** The timing comes from the injected cue source, not from anything the player computes. */
  it("advances on the current step's duration and stops at the end", () => {
    vi.useFakeTimers();
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    advance(4_000);
    expect(screen.getByTestId("position")).toHaveTextContent("2 of 3");

    advance(5_000);
    expect(screen.getByTestId("position")).toHaveTextContent("3 of 3");

    // Reaching the end stops playback rather than leaving a timer running.
    advance(10_000);
    expect(screen.getByTestId("position")).toHaveTextContent("3 of 3");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("pauses where it is, and stepping by hand pauses too", () => {
    vi.useFakeTimers();
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(4_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    advance(60_000);
    expect(screen.getByTestId("position")).toHaveTextContent("2 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });
});

describe("narration and accessibility", () => {
  /** M4 has no sound at all, so the lesson has to be followable as text (AC 16's sibling). */
  it("shows the current step's narration and updates it as steps change", () => {
    renderPlayer();
    expect(screen.getByText(/one quarter plus one quarter/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByText(/bottom number stays the same/i)).toBeInTheDocument();
  });

  it("labels the canvas with the lesson title for a screen reader", () => {
    renderPlayer();
    expect(screen.getByRole("img", { name: "Adding quarters" })).toBeInTheDocument();
  });
});

/**
 * **There is no reduced-motion test here any more, and that is the point.**
 *
 * There used to be one, and it passed: it asserted `transition-opacity` was in
 * the markup with motion allowed and absent with it reduced. Both assertions
 * were true and neither meant anything — the class transitioned no value, so
 * the two renders were pixel-identical either way. The test, the
 * `reducedMotion` prop and the `usePrefersReducedMotion` hook together made
 * AC 15 look implemented while nothing honoured anything.
 *
 * The animation was struck rather than written (ADR-0019's 2026-08-28 revision
 * note): adding motion so that a preference has something to switch off is
 * backwards. **M5 adds the first real reveal alongside narration and reinstates
 * the preference in the same change** — and that is when this test comes back,
 * asserting rendered output rather than a class string.
 */

describe("the annotation overlay in a layout-free environment", () => {
  /**
   * jsdom measures everything as 0x0. The Stage draws no annotation whose
   * target measured to nothing, because a ring at the origin is a mark that
   * means nothing — so an empty overlay here is correct, and the geometry is
   * proven separately in `layout.test.ts`.
   */
  it("draws no annotation rather than drawing one at the origin", () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    const stage = screen.getByRole("img", { name: "Adding quarters" });
    const svg = stage.querySelector("svg")!;
    expect(within(stage).getByText("denominators match")).toBeInTheDocument();
    expect(svg.querySelector("ellipse")).toBeNull();
  });
});
