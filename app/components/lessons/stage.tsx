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
  highlightFor,
  ringFor,
  strikeFor,
  underlineFor,
  type Box,
} from "@/lib/lessons/layout";
import { LESSON_LABEL_MAX_WIDTH } from "@/lib/config";
import type { RenderableDrawOp, RenderableLessonScript } from "@/lib/schemas/dto";

const SIZE_CLASS = { sm: "text-sm", md: "text-base", lg: "text-2xl" } as const;

export function Stage({
  script,
  visibleStepCount,
  reducedMotion = false,
}: {
  script: RenderableLessonScript;
  /** AC 12: the canvas at step k is the ops of steps 0..k folded in order. */
  visibleStepCount: number;
  /** AC 15. Removes the reveal transition; the final frame is identical. */
  reducedMotion?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elementRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });

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

    const next: Record<string, Box> = {};
    for (const [id, element] of elementRefs.current) {
      const rect = element.getBoundingClientRect();
      // Relative to the container, so both layers share one coordinate space.
      next[id] = {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      };
    }
    setBoxes(next);
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
          className={`absolute -translate-x-1/2 -translate-y-1/2 text-foreground ${
            op.kind === "write" ? SIZE_CLASS[op.size] : "text-sm"
          } ${reducedMotion ? "" : "transition-opacity duration-300"}`}
          style={{
            left: `${op.at.x * 100}%`,
            top: `${op.at.y * 100}%`,
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
        {annotations.map((op) => renderAnnotation(op, boxes))}
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
function renderAnnotation(op: RenderableDrawOp, boxes: Record<string, Box>) {
  const stroke = "currentColor";
  const common = { stroke, fill: "none", strokeWidth: 2, className: "text-primary" };

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
          className="text-primary/20"
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
