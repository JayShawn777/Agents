// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { Stage } from "@/components/lessons/stage";
import type { RenderableLessonScript } from "@/lib/schemas/dto";

/**
 * **The layout pass, exercised for real — which the rest of the suite cannot do.**
 *
 * jsdom performs no layout, so every `getBoundingClientRect` returns zeros, the
 * Stage's `laidOut` guard is false on every measure, and the clamp never runs.
 * That was proven by mutation during the M4 review: deleting the correction
 * entirely and running every component and layout test left 55/55 green. The
 * defect it exists to prevent — a wrapped label clipped by `overflow-hidden` at
 * 375px — could come straight back without a single red test.
 *
 * So this file gives jsdom just enough of a browser to be honest: a stage of a
 * fixed size, and elements whose reported rect is their CSS-centred position
 * PLUS whatever offset the component has actually written into their own inline
 * transform. That last part is what makes the harness faithful rather than
 * flattering — it closes the feedback loop the component depends on, so a
 * measure that double-counts its own correction shows up here as drift.
 */

const STAGE = { width: 343, height: 257 };

/** Intrinsic sizes. `rule` is the four-line wrapped label from the reading fixture. */
const SIZES: Record<string, { width: number; height: number }> = {
  rule: { width: 75, height: 80 },
  sum: { width: 60, height: 30 },
};

function offsetFromTransform(element: HTMLElement): { dx: number; dy: number } {
  const matches = [...element.style.transform.matchAll(/calc\(-50% \+ (-?[\d.]+)px\)/g)];
  return { dx: Number(matches[0]?.[1] ?? 0), dy: Number(matches[1]?.[1] ?? 0) };
}

function installLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ): DOMRect {
    if (this.hasAttribute("data-lesson-stage")) {
      return { x: 0, y: 0, left: 0, top: 0, ...STAGE, right: STAGE.width, bottom: STAGE.height } as DOMRect;
    }

    const id = this.getAttribute("data-lesson-element");
    if (!id) return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 } as DOMRect;

    const size = SIZES[id] ?? { width: 40, height: 20 };
    // The CSS the component actually writes: `left`/`top` as percentages of the
    // stage, then translate(-50%, -50%) plus the layout pass's correction.
    const centreX = (parseFloat(this.style.left) / 100) * STAGE.width;
    const centreY = (parseFloat(this.style.top) / 100) * STAGE.height;
    const { dx, dy } = offsetFromTransform(this);
    const left = centreX - size.width / 2 + dx;
    const top = centreY - size.height / 2 + dy;

    return { x: left, y: top, left, top, ...size, right: left + size.width, bottom: top + size.height } as DOMRect;
  });
}

/** The exact shape that failed in Chromium: a tall wrapped label near the top edge. */
const SCRIPT: RenderableLessonScript = {
  title: "Finding the topic sentence",
  steps: [
    {
      id: "s1",
      narration: "The topic sentence tells the main idea.",
      durationMs: 4000,
      ops: [
        { kind: "label", id: "rule", text: "the main idea of the whole paragraph", at: { x: 0.78, y: 0.14 } },
      ],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the stage's layout pass", () => {
  it("shifts an element that would overflow the top edge back inside the stage", async () => {
    installLayout();
    const view = render(<Stage script={SCRIPT} visibleStepCount={1} />);
    await act(async () => {});

    const element = view.container.querySelector<HTMLElement>('[data-lesson-element="rule"]')!;
    const { dy } = offsetFromTransform(element);

    // Centred on y = 0.14 * 257 = 35.98 with a height of 80, the box starts at
    // -4.02: above the stage, and clipped away by `overflow-hidden`.
    expect(dy).toBeGreaterThan(0);

    const box = element.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(STAGE.height);
  });

  it("leaves an element that already fits completely alone", async () => {
    installLayout();
    const fits: RenderableLessonScript = {
      title: "t",
      steps: [
        {
          id: "s1",
          narration: "n",
          durationMs: 1000,
          ops: [{ kind: "label", id: "sum", text: "one half", at: { x: 0.5, y: 0.5 } }],
        },
      ],
    };
    const view = render(<Stage script={fits} visibleStepCount={1} />);
    await act(async () => {});

    expect(offsetFromTransform(view.container.querySelector<HTMLElement>('[data-lesson-element="sum"]')!)).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  /**
   * The correction is derived from the UNCORRECTED box — the reported rect minus
   * the offset already applied. If that subtraction were dropped, each measure
   * would clamp an already-clamped box and the element would walk down the
   * stage one correction at a time. Re-rendering drives another measure pass.
   */
  it("is stable across repeated measures rather than drifting", async () => {
    installLayout();
    const view = render(<Stage script={SCRIPT} visibleStepCount={1} />);
    await act(async () => {});

    const read = () =>
      offsetFromTransform(view.container.querySelector<HTMLElement>('[data-lesson-element="rule"]')!).dy;
    const settled = read();

    for (let pass = 0; pass < 3; pass++) {
      view.rerender(<Stage script={SCRIPT} visibleStepCount={1} />);
      await act(async () => {});
      expect(read()).toBe(settled);
    }
  });
});
