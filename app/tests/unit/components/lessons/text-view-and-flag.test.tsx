// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { LessonTextView } from "@/components/lessons/lesson-text-view";
import { FlagLesson } from "@/components/lessons/flag-lesson";
import { PlayerControls } from "@/components/lessons/player-controls";
import type { PlayerState } from "@/components/lessons/lesson-player";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

/**
 * `lesson-text-view.tsx` (AC 16), `flag-lesson.tsx` (AC 18) and
 * `player-controls.tsx` (AC 12).
 */

const SCRIPT: RenderableLessonScript = {
  title: "Adding quarters",
  steps: [
    {
      id: "s1",
      narration: "We start with one quarter plus one quarter.",
      durationMs: 4_000,
      ops: [
        {
          kind: "write",
          id: "sum",
          latex: "\\frac{1}{4}+\\frac{1}{4}",
          latexHtml: '<span class="katex">one quarter plus one quarter</span>',
          at: { x: 0.5, y: 0.3 },
          size: "lg",
        },
      ],
    },
    {
      id: "s2",
      narration: "The bottom number stays the same, so we add only the tops.",
      durationMs: 5_000,
      ops: [
        { kind: "label", id: "rule", text: "denominators match", at: { x: 0.5, y: 0.5 } },
        { kind: "circle", id: "ring", target: "sum" },
        { kind: "arrow", id: "link", from: "rule", to: "sum", curve: "arc" },
      ],
    },
  ],
};

const VERSION_ID = "clh3k2j9x0000qwer1234abcd";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────── AC 16 ───────────────────────────

describe("the static text view (AC 16)", () => {
  it("presents every step in order, with its narration", () => {
    render(<LessonTextView script={SCRIPT} />);

    const steps = screen.getAllByRole("listitem").filter((item) => item.textContent?.startsWith("Step "));
    expect(steps).toHaveLength(2);
    expect(screen.getByText(/one quarter plus one quarter\./i)).toBeInTheDocument();
    expect(screen.getByText(/bottom number stays the same/i)).toBeInTheDocument();
  });

  /**
   * "Complete without the canvas" is the criterion. An annotation described as
   * "circle → sum" is a dump of the document; described by what it points AT,
   * it is a worked example a child can follow with the screen reader on.
   */
  it("describes annotations by what they point at, not by element id", () => {
    render(<LessonTextView script={SCRIPT} />);

    expect(screen.getByText(/Circled:/)).toHaveTextContent("Circled: \\frac{1}{4}+\\frac{1}{4}");
    expect(screen.getByText(/Arrow from/)).toHaveTextContent("Arrow from denominators match to \\frac{1}{4}+\\frac{1}{4}");
    // The raw ids must not surface.
    expect(screen.queryByText(/\bring\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  /** AC 14 does not stop applying because the canvas is gone. */
  it("still renders mathematics as mathematics", () => {
    const { container } = render(<LessonTextView script={SCRIPT} />);
    expect(container.innerHTML).toContain("katex");
  });

  /**
   * A SIBLING of the player, not a mode inside it. It must render with no
   * timers, no canvas and no player state — which is what makes it work with
   * JavaScript disabled.
   */
  it("renders with no player, no canvas and no timers", () => {
    const { container } = render(<LessonTextView script={SCRIPT} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ─────────────────────────── AC 18 ───────────────────────────

describe("flagging a lesson (AC 18)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { flag: { id: "flag_1" } } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  const renderFlag = (stepIndex: number | null = 1, atVersionCap = false) =>
    render(
      <FlagLesson lessonId="les_1" versionId={VERSION_ID} stepIndex={stepIndex} atVersionCap={atVersionCap} />,
    );

  it("offers four fixed reasons and no free-text box", () => {
    renderFlag();
    fireEvent.click(screen.getByRole("button", { name: /something's not right/i }));

    expect(screen.getByRole("button", { name: "This is confusing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Too fast" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This looks wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not my problem" })).toBeInTheDocument();

    // The COPPA decision, asserted at the surface: a free-text box on a
    // child-facing screen is a new unbounded personal-data channel.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sends the reason and the step that was showing", async () => {
    renderFlag(1);
    fireEvent.click(screen.getByRole("button", { name: /something's not right/i }));
    fireEvent.click(screen.getByRole("button", { name: "This looks wrong" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/lessons/les_1/flags");
    expect(JSON.parse(init.body)).toEqual({ versionId: VERSION_ID, stepIndex: 1, reason: "WRONG" });
  });

  it("sends a null step when no step was selected", async () => {
    renderFlag(null);
    fireEvent.click(screen.getByRole("button", { name: /something's not right/i }));
    fireEvent.click(screen.getByRole("button", { name: "This is confusing" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stepIndex).toBeNull();
  });

  /**
   * AC 18 asks for a regeneration to be OFFERED after a flag. Thanking a child
   * and leaving them with the lesson they just said was wrong is the wrong
   * place to stop.
   */
  it("offers a regeneration once the flag lands", async () => {
    renderFlag();
    fireEvent.click(screen.getByRole("button", { name: /something's not right/i }));
    fireEvent.click(screen.getByRole("button", { name: "This is confusing" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /try a different explanation/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/thanks for telling us/i)).toBeInTheDocument();
  });

  /** At the version cap there is nothing left to offer, so it points somewhere real. */
  it("points at the tutor instead when no regenerations remain", async () => {
    renderFlag(1, true);
    fireEvent.click(screen.getByRole("button", { name: /something's not right/i }));
    fireEvent.click(screen.getByRole("button", { name: "This is confusing" }));

    await waitFor(() => expect(screen.getByText(/ask the tutor about this problem/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /try a different explanation/i })).not.toBeInTheDocument();
  });

  it("shows the allowlisted message and stays open on a failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "We couldn't find that." } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderFlag();
    fireEvent.click(screen.getByRole("button", { name: /something's not right/i }));
    fireEvent.click(screen.getByRole("button", { name: "Too fast" }));

    await waitFor(() => expect(screen.getByText("We couldn't find that.")).toBeInTheDocument());
    expect(screen.queryByText(/thanks for telling us/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────── AC 12's controls ───────────────────────────

describe("the player controls (AC 12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The captions toggle PATCHes endpoint 4 (AC 18); nothing in this describe
    // asserts on the request itself, so a bare success response is enough to
    // keep the toggle's own `startTransition` from hitting a real network call.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, data: { student: { id: "st_1" } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const state = (overrides: Partial<PlayerState> = {}): PlayerState => ({
    stepIndex: 1,
    stepCount: 6,
    isPlaying: false,
    atEnd: false,
    atStart: false,
    narration: "",
    isMuted: false,
    hasAudio: false,
    toggleMute: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    replay: vi.fn(),
    ...overrides,
  });

  const renderControls = (player: PlayerState, extra: { captionsEnabled?: boolean } = {}) =>
    render(
      <PlayerControls
        state={player}
        studentId="st_1"
        captionsEnabled={extra.captionsEnabled ?? true}
        onCaptionsChange={vi.fn()}
      />,
    );

  it("calls straight into the player's state, deciding nothing itself", () => {
    const player = state();
    renderControls(player);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));

    expect(player.play).toHaveBeenCalledOnce();
    expect(player.next).toHaveBeenCalledOnce();
    expect(player.previous).toHaveBeenCalledOnce();
    expect(player.replay).toHaveBeenCalledOnce();
  });

  it("shows pause while playing", () => {
    const player = state({ isPlaying: true });
    renderControls(player);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(player.pause).toHaveBeenCalledOnce();
  });

  it("disables stepping past either end", () => {
    const { rerender } = render(
      <PlayerControls
        state={state({ atStart: true })}
        studentId="st_1"
        captionsEnabled={true}
        onCaptionsChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();

    rerender(
      <PlayerControls
        state={state({ atEnd: true, atStart: false })}
        studentId="st_1"
        captionsEnabled={true}
        onCaptionsChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
  });

  /**
   * A counter that only counts up, naming a boundary the child was told about.
   * M2 AC 20's rule — a child never sees a number that can fall — does not stop
   * applying because the screen changed.
   */
  it("counts steps and renders no percentage or score", () => {
    const { container } = renderControls(state());
    expect(screen.getByText("Step 2 of 6")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/%|score|\d+\s*\/\s*\d+/);
  });

  /** AC 16: mute has nothing to mute without narration audio. */
  it("disables mute when the lesson has no narration audio", () => {
    renderControls(state({ hasAudio: false }));
    expect(screen.getByRole("button", { name: "Mute" })).toBeDisabled();
  });

  it("calls toggleMute, and does not require narration to render", () => {
    const player = state({ hasAudio: true });
    renderControls(player);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(player.toggleMute).toHaveBeenCalledOnce();
  });

  it("shows the caption toggle's current state and reflects a click optimistically", async () => {
    const onCaptionsChange = vi.fn();
    render(
      <PlayerControls state={state()} studentId="st_1" captionsEnabled={true} onCaptionsChange={onCaptionsChange} />,
    );

    const toggle = screen.getByRole("button", { name: "Turn off captions" });
    fireEvent.click(toggle);

    expect(onCaptionsChange).toHaveBeenCalledWith(false);
  });
});
