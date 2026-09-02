// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import type { LessonNarrationDTO, NarrationStepDTO, RenderableLessonScript } from "@/lib/schemas/dto";
import type { Cue } from "@/lib/lessons/cues";

/**
 * `components/lessons/narration-state.tsx` — **which had NO test file at all**
 * until the 2026-09-02 review. It owns the poll interval (the M4 refresh-storm
 * repeat risk), the auto-request, the retry, and the signed-URL refresh, and
 * none of it was covered.
 *
 * `LessonView` is stubbed to a probe that renders the props it was handed, so
 * these tests are about this component's lifecycle rather than the player's
 * rendering — which `lesson-player.test.tsx` already covers directly.
 */

const apiFetchMock = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: apiFetchMock }));

/** Captures what NarrationState passes down, including whether the refresh callback is wired at all. */
let lastViewProps: { narrationSteps: NarrationStepDTO[] | null; onNarrationStale?: () => void } | null = null;

vi.mock("@/components/lessons/lesson-view", () => ({
  LessonView: (props: { narrationSteps: NarrationStepDTO[] | null; onNarrationStale?: () => void }) => {
    lastViewProps = props;
    return (
      <div
        data-testid="lesson-view"
        data-has-stale-handler={props.onNarrationStale ? "yes" : "no"}
        data-step-count={props.narrationSteps ? String(props.narrationSteps.length) : "none"}
      />
    );
  },
}));

const { NarrationState } = await import("@/components/lessons/narration-state");

const SCRIPT = {
  title: "Adding quarters",
  steps: [
    { id: "s1", narration: "One quarter.", durationMs: 4_000, ops: [] },
    { id: "s2", narration: "Another quarter.", durationMs: 4_000, ops: [] },
    { id: "s3", narration: "Two quarters.", durationMs: 3_000, ops: [] },
  ],
} as unknown as RenderableLessonScript;

const TIMELINE: Cue[] = [
  { stepId: "s1", startOffsetMs: 0, durationMs: 4_000 },
  { stepId: "s2", startOffsetMs: 4_000, durationMs: 4_000 },
  { stepId: "s3", startOffsetMs: 8_000, durationMs: 3_000 },
];

function narration(overrides: Partial<LessonNarrationDTO> = {}): LessonNarrationDTO {
  return {
    id: "narr_1",
    versionId: "ver_1",
    status: "READY",
    stepCount: 3,
    totalDurationMs: 10_600,
    failureMessage: null,
    persona: { id: "p1", slug: "professor-love", label: "Professor Love" },
    steps: [
      {
        stepId: "s1",
        stepIndex: 0,
        startOffsetMs: 0,
        durationMs: 3_500,
        audioUrl: "https://blob.example/s1.mp3",
        audioUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        words: [],
      },
    ],
    ...overrides,
  } as LessonNarrationDTO;
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const err = (message: string) => ({ ok: false as const, error: { code: "INTERNAL", message } });

function renderState() {
  return render(
    <NarrationState
      lessonId="les_1"
      versionId="ver_1"
      studentId="sp_1"
      script={SCRIPT}
      timeline={TIMELINE}
      atVersionCap={false}
      initialCaptionsEnabled
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lastViewProps = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * THE finding: `LessonPlayer` schedules the signed-URL refresh, but its effect
 * returns early without this prop — and this component, the only production
 * caller of `LessonView`, did not pass it. Deleting the entire refresh effect
 * left 83/83 in-scope tests green. Audio for a lesson longer than
 * `SIGNED_URL_TTL_MS` (5 minutes) went dead with no error path.
 */
describe("the signed-URL refresh is wired (2026-09-02)", () => {
  it("passes onNarrationStale down to the view", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration() }));
    renderState();
    await act(async () => {});

    expect(screen.getByTestId("lesson-view")).toHaveAttribute("data-has-stale-handler", "yes");
    expect(typeof lastViewProps?.onNarrationStale).toBe("function");
  });

  it("re-reads the narration when the player reports its URLs are going stale", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration() }));
    renderState();
    await act(async () => {});

    const callsBefore = apiFetchMock.mock.calls.length;
    await act(async () => {
      lastViewProps!.onNarrationStale!();
    });

    // A GET mints fresh signed URLs — re-reading IS the refresh, so the proof is
    // that invoking the callback actually issues one.
    expect(apiFetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    const lastCall = apiFetchMock.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("/api/lessons/les_1/narration");
    expect(lastCall[1]?.method).toBeUndefined(); // a GET, not another POST
  });

  it("the refresh callback keeps a stable identity across re-renders", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration() }));
    const { rerender } = renderState();
    await act(async () => {});
    const first = lastViewProps!.onNarrationStale;

    rerender(
      <NarrationState
        lessonId="les_1"
        versionId="ver_1"
        studentId="sp_1"
        script={SCRIPT}
        timeline={TIMELINE}
        atVersionCap={false}
        initialCaptionsEnabled
      />,
    );
    await act(async () => {});

    // The player lists it as an effect dependency; an unstable identity would
    // re-schedule the refresh timer on every render and never fire it.
    expect(lastViewProps!.onNarrationStale).toBe(first);
  });
});

describe("the poller (the M4 refresh-storm shape)", () => {
  it("stops polling once a run is READY", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "READY" }) }));
    renderState();
    await act(async () => {});

    const afterFirst = apiFetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(apiFetchMock.mock.calls.length).toBe(afterFirst);
  });

  it("stops polling on a failing GET rather than hammering it", async () => {
    apiFetchMock.mockResolvedValue(err("boom"));
    renderState();
    await act(async () => {});

    const afterFirst = apiFetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(apiFetchMock.mock.calls.length).toBe(afterFirst);
  });

  it("keeps polling while a run is still GENERATING", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "GENERATING", steps: [] }) }));
    renderState();
    await act(async () => {});

    const afterFirst = apiFetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });

    expect(apiFetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("clears its interval on unmount", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "GENERATING", steps: [] }) }));
    const { unmount } = renderState();
    await act(async () => {});

    unmount();
    const afterUnmount = apiFetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(apiFetchMock.mock.calls.length).toBe(afterUnmount);
  });

  it("auto-requests a first run, exactly once, for a lesson that has never been narrated", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: null }));
    renderState();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });

    const posts = apiFetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(1);
  });
});

/**
 * The second playback finding: `retry()` POSTed and set state while the FAILED
 * branch had already cleared the interval, so the new run was never polled and
 * never resolved without a full page reload.
 */
describe("retry restarts the poller (2026-09-02)", () => {
  it("polls again after a retry, so a recovered run resolves without a reload", async () => {
    // First GET: FAILED, which stops the interval and renders the retry button.
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "FAILED", failureMessage: "The narration voice isn't available right now.", steps: [] }) }));
    renderState();
    await act(async () => {});

    const retryButton = screen.getByRole("button", { name: /try narration again/i });

    // The retry POST succeeds and hands back a PENDING run.
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "PENDING", steps: [] }) }));
    await act(async () => {
      retryButton.click();
    });

    const afterRetry = apiFetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });

    expect(apiFetchMock.mock.calls.length).toBeGreaterThan(afterRetry);
  });

  it("shows the failure message and the retry affordance when a run FAILED", async () => {
    apiFetchMock.mockResolvedValue(
      ok({
        narration: narration({
          status: "FAILED",
          failureMessage: "The narration voice isn't available right now.",
          steps: [],
        }),
      }),
    );
    renderState();
    await act(async () => {});

    expect(screen.getByText(/narration voice isn't available/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try narration again/i })).toBeInTheDocument();
    // AC 17: the lesson still plays, with captions — the view is rendered either way.
    expect(screen.getByTestId("lesson-view")).toBeInTheDocument();
  });

  it("surfaces a retry failure without wedging the component", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "FAILED", failureMessage: "The narration voice isn't available right now.", steps: [] }) }));
    renderState();
    await act(async () => {});

    apiFetchMock.mockResolvedValue(err("Narration for this lesson is already on its way."));
    await act(async () => {
      screen.getByRole("button", { name: /try narration again/i }).click();
    });

    expect(screen.getByText(/already on its way/i)).toBeInTheDocument();
    expect(screen.getByTestId("lesson-view")).toBeInTheDocument();
  });
});

describe("what reaches the player", () => {
  it("hands down steps only for a READY run", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "READY" }) }));
    renderState();
    await act(async () => {});

    expect(screen.getByTestId("lesson-view")).toHaveAttribute("data-step-count", "1");
  });

  it("hands down null steps for a PENDING run, so the lesson plays on the M4 timer", async () => {
    apiFetchMock.mockResolvedValue(ok({ narration: narration({ status: "PENDING", steps: [] }) }));
    renderState();
    await act(async () => {});

    expect(screen.getByTestId("lesson-view")).toHaveAttribute("data-step-count", "none");
  });
});
