// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { Stage } from "@/components/lessons/stage";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

/**
 * `stage.tsx`'s reveal animation (AC 15) — M5's first REAL animation, and the
 * reason `usePrefersReducedMotion` was worth recovering.
 *
 * **What the M4-era version got away with, and why this file is stricter.**
 * The struck implementation asserted a class STRING was present or absent
 * and never asserted anything about what the two renders actually LOOKED
 * like — `transition-opacity` was in the markup either way and transitioned
 * no value, so the assertion passed while nothing was honoured
 * (`lesson-player.test.tsx`'s own note on this). This file instead asserts
 * the one property AC 15 actually requires: the reveal class differs between
 * the two preferences, and BOTH renders place the identical element with the
 * identical final content — the "final frame is identical either way" half
 * of the criterion, checked directly rather than assumed.
 */

const SCRIPT: RenderableLessonScript = {
  title: "One step",
  steps: [
    {
      id: "s1",
      narration: "Here is the answer.",
      durationMs: 1_000,
      ops: [
        { kind: "write", id: "answer", latex: "x", latexHtml: "<span>answer-html</span>", at: { x: 0.5, y: 0.5 }, size: "lg" },
      ],
    },
  ],
};

function installMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the step-reveal animation", () => {
  it("plays a reveal class on the placed element when motion is allowed", () => {
    installMatchMedia(false);
    const { container } = render(<Stage script={SCRIPT} visibleStepCount={1} />);
    const element = container.querySelector('[data-lesson-element="answer"]')!;
    expect(element.className).toMatch(/animate-in/);
    expect(element.className).toMatch(/fade-in-0/);
  });

  it("omits the reveal class entirely when the viewer prefers reduced motion", () => {
    installMatchMedia(true);
    const { container } = render(<Stage script={SCRIPT} visibleStepCount={1} />);
    const element = container.querySelector('[data-lesson-element="answer"]')!;
    expect(element.className).not.toMatch(/animate-in/);
  });

  /**
   * AC 15's binding constraint: the animation must never change what a step
   * looks like once shown, only whether arriving there was seen. The content
   * and every positioning style are identical with motion allowed or reduced
   * — only the reveal class differs.
   */
  it("renders the identical content and position either way", () => {
    installMatchMedia(false);
    const allowed = render(<Stage script={SCRIPT} visibleStepCount={1} />);
    const allowedElement = allowed.container.querySelector('[data-lesson-element="answer"]')!;
    const allowedStyle = allowedElement.getAttribute("style");
    const allowedText = allowedElement.textContent;
    allowed.unmount();

    installMatchMedia(true);
    const reduced = render(<Stage script={SCRIPT} visibleStepCount={1} />);
    const reducedElement = reduced.container.querySelector('[data-lesson-element="answer"]')!;

    expect(reducedElement.getAttribute("style")).toBe(allowedStyle);
    expect(reducedElement.textContent).toBe(allowedText);
  });
});
