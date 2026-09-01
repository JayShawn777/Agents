"use client";

/**
 * The drawing surface (ADR-0019).
 *
 * **Two layers in one positioned container.** `write` and `label` are
 * absolutely-positioned HTML — that is what KaTeX emits and what a browser is
 * good at laying out. Everything else is an SVG overlay of lines, ellipses and
 * paths, drawn *around* those elements. Canvas 2D cannot draw KaTeX at all
 * (measured: it emits nested `<span>` and no `<svg>`), which is what ruled it
 * out.
 *
 * **Measure, then draw.** Annotations carry no coordinates by design — they name
 * an element and let the renderer find it — so the placed elements must be laid
 * out and measured before a single ring can be drawn. That is why this is a
 * client component at all, and why the geometry it calls into
 * (`lib/lessons/layout.ts`) is pure: all the arithmetic is unit-tested without a
 * browser, and only the measuring happens here.
 *
 * **No KaTeX ships to the browser.** Each `write` op arrives with `latexHtml`
 * already rendered on the server (`lib/lessons/dto.ts`). This component
 * positions HTML fragments; it never imports the library.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  arrowPathFor,
  bracePathFor,
  clampToBounds,
  highlightFor,
  offsetToBounds,
  ringFor,
  strikeFor,
  underlineFor,
  type Box,
} from "@/lib/lessons/layout";
import { LESSON_LABEL_MAX_WIDTH } from "@/lib/config";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { RenderableDrawOp, RenderableLessonScript } from "@/lib/schemas/dto";

const SIZE_CLASS = { sm: "text-sm", md: "text-base", lg: "text-2xl" } as const;

/** A layout-pass correction in container pixels. */
type Offset = { dx: number; dy: number };

const ZERO_OFFSET: Offset = { dx: 0, dy: 0 };

function sameOffsets(a: Record<string, Offset>, b: Record<string, Offset>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => b[key] && a[key].dx === b[key].dx && a[key].dy === b[key].dy);
}

export function Stage({
  script,
  visibleStepCount,
}: {
  script: RenderableLessonScript;
  /** AC 12: the canvas at step k is the ops of steps 0..k folded in order. */
  visibleStepCount: number;
}) {
  // AC 15. Read once per render, not once ever: someone can turn motion off
  // mid-lesson and the very next step revealed should honour it immediately.
  const reducedMotion = usePrefersReducedMotion();
  // A real `animation` (tw-animate-css, already a project dependency —
  // `app/globals.css` imports it), not a `transition`: each placement DIV is
  // keyed by `op.id` and mounts EXACTLY ONCE, the render its step first
  // becomes visible, so this class plays on that mount and never again for
  // the same element — genuine motion, not the struck no-op
  // (`transition-opacity` that transitioned nothing, ADR-0019's 2026-08-28
  // note). With motion reduced, the class is simply omitted: the element
  // renders at its final, fully-opaque state on the very first frame either
  // way — AC 15's "the final frame is identical" by construction, since
  // nothing here changes WHAT is drawn, only whether arriving at it is seen.
  const revealClass = reducedMotion ? "" : "animate-in fade-in-0 duration-300 ease-out";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elementRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  /**
   * The layout pass's corrections, in pixels, keyed by element id. Mirrored
   * into a ref because `measure` must subtract the offset it already applied
   * to recover the element's uncorrected position — reading that from state
   * would make `measure` depend on its own output.
   */
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const offsetsRef = useRef<Record<string, Offset>>({});

  const visible = script.steps.slice(0, Math.max(visibleStepCount, 0));
  const placements = visible.flatMap((step) =>
    step.ops.filter((op): op is Extract<RenderableDrawOp, { at: unknown }> => op.kind === "write" || op.kind === "label"),
  );
  const annotations = visible.flatMap((step) =>
    step.ops.filter((op) => op.kind !== "write" && op.kind !== "label"),
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    setSize({ width: bounds.width, height: bounds.height });

    const viewport = { width: bounds.width, height: bounds.height };
    // A container with no layout yet (hidden, or before the first paint) would
    // clamp every element onto the origin. Measure, but correct nothing.
    const laidOut = viewport.width > 0 && viewport.height > 0;

    const next: Record<string, Box> = {};
    const nextOffsets: Record<string, Offset> = {};
    for (const [id, element] of elementRefs.current) {
      const rect = element.getBoundingClientRect();
      // Relative to the container, so both layers share one coordinate space.
      const measured = {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      };
      // Where CSS centring alone would have put it: what the browser reports
      // MINUS the correction already applied. Deriving the next correction from
      // the uncorrected box is what makes this idempotent — re-measuring on a
      // resize or a font load recomputes the same answer rather than drifting
      // one clamp further each time.
      const applied = offsetsRef.current[id] ?? ZERO_OFFSET;
      const uncorrected = { ...measured, x: measured.x - applied.dx, y: measured.y - applied.dy };

      next[id] = laidOut ? clampToBounds(uncorrected, viewport) : uncorrected;
      const offset = laidOut ? offsetToBounds(uncorrected, viewport) : ZERO_OFFSET;
      if (offset.dx !== 0 || offset.dy !== 0) nextOffsets[id] = offset;
    }
    setBoxes(next);

    // Guarded: the common case is that nothing needs moving, and setting a
    // fresh object every measure would re-render on every resize tick.
    if (!sameOffsets(offsetsRef.current, nextOffsets)) {
      offsetsRef.current = nextOffsets;
      setOffsets(nextOffsets);
    }
  }, []);

  // Layout effect, not effect: measure before the browser paints, so the
  // overlay is not one frame behind the elements it annotates.
  useLayoutEffect(() => {
    measure();
  }, [measure, visibleStepCount, script]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    // ADR-0019's named determinism hazard: an annotation's size derives from a
    // measured box, and a font that has not loaded yet measures differently.
    // Re-measuring once fonts settle is what stops the first paint and the
    // steady state disagreeing.
    if (typeof document === "undefined" || !("fonts" in document)) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [measure]);

  return (
    <div
      ref={containerRef}
      data-lesson-stage=""
      className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-card"
      role="img"
      aria-label={script.title}
    >
      {/* Placement layer. */}
      {placements.map((op) => (
        <div
          key={op.id}
          ref={(element) => {
            if (element) elementRefs.current.set(op.id, element);
            else elementRefs.current.delete(op.id);
          }}
          // A stable hook for the browser-based legibility measurement
          // (M4-3). Placed elements are the only things with a box worth
          // measuring, and finding them by class would break the moment the
          // styling changes.
          data-lesson-element={op.id}
          className={`absolute text-foreground ${op.kind === "write" ? SIZE_CLASS[op.size] : "text-sm"} ${revealClass}`}
          style={{
            left: `${op.at.x * 100}%`,
            top: `${op.at.y * 100}%`,
            // The centring translate lives here rather than in a Tailwind
            // class because the layout pass adds to it, and a `transform` in
            // `style` would otherwise silently override the class's.
            transform: `translate(calc(-50% + ${(offsets[op.id] ?? ZERO_OFFSET).dx}px), calc(-50% + ${
              (offsets[op.id] ?? ZERO_OFFSET).dy
            }px))`,
            // The 65-character label the model actually produced spans nearly
            // the whole canvas at 1280px and cannot fit one line at 375px.
            // Wrapping changes the element's height, which changes every
            // annotation drawn around it — safe, because boxes are measured
            // after layout rather than predicted.
            maxWidth: op.kind === "label" ? `${LESSON_LABEL_MAX_WIDTH * 100}%` : undefined,
            textAlign: "center",
          }}
        >
          {op.kind === "write" ? (
            <span dangerouslySetInnerHTML={{ __html: op.latexHtml }} />
          ) : (
            <span>{op.text}</span>
          )}
        </div>
      ))}

      {/* Annotation overlay. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        aria-hidden="true"
      >
        {/*
          Every `arrow` referenced `url(#lesson-arrowhead)` and this definition
          did not exist anywhere in the repository — an undefined marker
          reference is silently ignored, so every arrow drew as a bare curve.
          An `arrow` op carries no coordinates: its entire meaning is direction
          from one element to another, so without the head "this becomes that"
          renders as an ambiguous squiggle. Nothing could catch it — jsdom draws
          no annotations, and the e2e check only counts `svg *`.
        */}
        <defs>
          <marker
            id="lesson-arrowhead"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
            className="text-primary"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {annotations.map((op) => renderAnnotation(op, boxes, revealClass))}
      </svg>
    </div>
  );
}

/**
 * Returns `null` for any annotation whose targets have not been measured yet,
 * or measured to nothing. That is the honest state during the first layout pass
 * and in any environment without layout — drawing a ring at the origin because
 * a box came back 0x0 would put a mark on the canvas that means nothing.
 */
function renderAnnotation(op: RenderableDrawOp, boxes: Record<string, Box>, revealClass: string) {
  const stroke = "currentColor";
  // Same reveal as the placement layer, on the same "mounts once per op.id"
  // basis — an annotation naturally mounts a render AFTER its target is
  // first measured (see this function's own docstring), so it fades in
  // slightly behind the element it marks rather than simultaneously with it,
  // which reads as "pointing at", not as noise.
  const common = { stroke, fill: "none", strokeWidth: 2, className: `text-primary ${revealClass}` };

  const measured = (id: string): Box | null => {
    const box = boxes[id];
    return box && box.width > 0 && box.height > 0 ? box : null;
  };

  switch (op.kind) {
    case "circle": {
      const target = measured(op.target);
      if (!target) return null;
      const ring = ringFor(target);
      return <ellipse key={op.id} {...common} cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} />;
    }
    case "underline":
    case "strike": {
      const target = measured(op.target);
      if (!target) return null;
      const line = op.kind === "underline" ? underlineFor(target) : strikeFor(target);
      return <line key={op.id} {...common} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />;
    }
    case "highlight": {
      const target = measured(op.target);
      if (!target) return null;
      const rect = highlightFor(target);
      return (
        <rect
          key={op.id}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={3}
          className={`text-primary/20 ${revealClass}`}
          fill="currentColor"
        />
      );
    }
    case "arrow": {
      const from = measured(op.from);
      const to = measured(op.to);
      if (!from || !to) return null;
      return <path key={op.id} {...common} d={arrowPathFor(from, to, op.curve)} markerEnd="url(#lesson-arrowhead)" />;
    }
    case "brace": {
      const from = measured(op.from);
      const to = measured(op.to);
      if (!from || !to) return null;
      const brace = bracePathFor(from, to);
      return (
        <g key={op.id}>
          <path {...common} d={brace.path} />
          {op.label ? (
            <text x={brace.labelAt.x} y={brace.labelAt.y} textAnchor="middle" className="fill-current text-xs">
              {op.label}
            </text>
          ) : null}
        </g>
      );
    }
    default:
      return null;
  }
}
