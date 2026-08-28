# ADR-0019: A lesson renders as positioned HTML under an SVG annotation overlay, with LaTeX pre-rendered on the server

- **Status:** Accepted
- **Date:** 2026-08-28
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Revised:** 2026-08-28 (see "Revision note")
- **Spec:** docs/specs/m4-whiteboard-lessons.md
- **Measurement:** docs/research/m4-authoring-measurement.md (plan §9.2, M4-2)

## Revision note — 2026-08-28

**§4's AC 15 bullet is struck.** It claimed the renderer honours
`prefers-reduced-motion` by removing "a CSS transition on the placement layer
and a stroke reveal on the overlay". The M4 review found that **neither effect
exists**: the only motion-related token in `components/lessons/**` was
`transition-opacity duration-300`, and no opacity value is ever changed. There
is no stroke reveal on the overlay at all.

So the ADR was describing an animation nobody wrote, and AC 15 was satisfied
only vacuously — there were no frames that could differ. Worse, the plumbing
made it *look* satisfied: a `usePrefersReducedMotion` hook fed a `reducedMotion`
prop that toggled a class with no effect, and the test asserted that class
string was present and then absent. A green test, an implemented-looking prop,
and no behaviour underneath.

**The decision: strike the claim and delete the plumbing**, rather than
implement a reveal now. A lesson is a static fold over steps 0..k today (§4's
AC 12 bullet), and adding an animation purely so that an accessibility
preference has something to switch off is backwards. The rest of §4 is
unaffected — AC 11, 12, 13, 14 and 16 are all built and reviewed.

**What this obliges M5 to do.** M5 introduces narration, which is the first
thing in this product with a real timeline, and any reveal synchronised to it is
exactly the motion AC 15 was written for. **Whoever builds M5 reinstates the
preference alongside the first real animation, not after it** — the deleted hook
(`useSyncExternalStore` over a `matchMedia` subscription, with a `false` server
snapshot so hydration corrects it rather than flashing) was correct and is worth
recovering from this file's history.

Until then the honest statement is the one now in the M4 spec: a lesson has no
animation, so there is nothing for the preference to remove.

## Context

Plan §9.2's M4-2 asks which renderer M4 is built on, and names the problem it
exists to settle: **"canvas 2D cannot draw KaTeX output — KaTeX emits HTML and
CSS, and AC 14 requires real mathematics. This is a genuine gap in the spec's
'canvas' framing."** The spec says "whiteboard" and "canvas" throughout; those
are descriptions of what a child sees, not a commitment to the `<canvas>`
element, and nothing downstream had been decided.

Confirmed rather than assumed, on 2026-08-28:

```
katex.renderToString('\\frac{1}{4}')  →  1,363 characters
  contains <svg>:  false
  contains <span>: true   (nested spans, plus a MathML <math> block)
```

So the gap is real. There is no supported way to paint that into a 2D context:
the browser will not rasterise arbitrary HTML into a canvas, and re-implementing
fraction, radical and script layout to draw glyphs by hand is a typesetting
project, not a milestone.

The second fact that shapes this decision comes from ADR-0014 §2's own design.
**Annotation primitives carry no coordinates.** `circle`, `underline`, `strike`,
`highlight`, `arrow` and `brace` refer to an element by id and let the renderer
work out where it landed. That is what stops the model inventing an arrow that
starts nowhere near its target — and it means the renderer *must* measure the
placed elements before it can draw a single annotation. Whatever substrate is
chosen, there is a measure-then-draw pass.

## Decision

**Placed elements are absolutely-positioned HTML. Annotations are an SVG
overlay. LaTeX is rendered to HTML on the server.**

### 1. Two layers, and which op goes where

ADR-0014's vocabulary already splits cleanly in two, and the renderer follows
that split exactly:

| Layer | Ops | Why |
|---|---|---|
| **HTML**, absolutely positioned | `write`, `label` | They carry a coordinate and contain text or mathematics. HTML is what KaTeX emits and what a browser is good at laying out. |
| **SVG overlay**, `pointer-events: none` | `circle`, `underline`, `strike`, `highlight`, `arrow`, `brace` | They are lines, ellipses and paths around or between boxes — exactly what vector drawing is for. |

Both layers sit in one positioned container and share its coordinate space, so
"the box of element `sum`" means the same thing to both.

### 2. Playback is measure-then-draw

1. Place every `write` / `label` at its normalised coordinate scaled to the
   container, centred on that point.
2. Measure the placed elements (`getBoundingClientRect`, relative to the
   container).
3. Derive every annotation's geometry from the measured boxes
   (`lib/lessons/layout.ts` — pure functions, no DOM).
4. Emit the overlay.

Step 3 being pure is the load-bearing part: it is where AC 11's determinism
lives, it is unit-testable with no browser, and it is what M4-3's legibility
measurement runs against.

### 3. LaTeX is rendered on the server, so no KaTeX ships to the browser

A lesson script is authored, validated and stored **before** anyone plays it.
Every `write` op's `latex` is therefore known ahead of time and is rendered to
HTML server-side with the same `renderMathText` path M1, M2 and M3 already use
(ADR-0005). The player receives HTML fragments and positions them; it never
imports KaTeX.

This is the same finding that removed the lazy KaTeX chunk from M3's chat: work
out what is already known on the server, and the browser stops needing the
library. **ADR-0005's "no KaTeX JavaScript reaches the browser" now holds across
the entire application, with no exception anywhere.**

### 4. What this buys for the acceptance criteria

- **AC 14** (real mathematics) — KaTeX HTML, unmodified, in the layer built for it.
- **AC 13** (legible at 375px and 1280px) — coordinates are normalised; only the
  container size changes. Nothing in the stored document is a pixel.
- **AC 11** (deterministic) — the draw is a pure function of (script, container
  size, measured boxes). No randomness, no clock. Same viewport, same output.
- ~~**AC 15** (`prefers-reduced-motion`) — animation is a CSS transition on the
  placement layer and a stroke reveal on the overlay. Both are opt-in effects on
  top of a static final frame, so honouring the preference is *removing* them,
  never a second rendering path that could diverge.~~ **Struck 2026-08-28 — see
  the Revision note.** Neither effect was ever built, so this claimed an
  accessibility property the renderer does not have.
- **AC 16** (static text view) — narration is already text, and the ops are
  already a list. The text view does not render the canvas at all; it is a
  sibling of the player, not a mode inside it.
- **AC 12** (step backward = play forward to step *k*) — the canvas at step *k*
  is the ops of steps 0..*k* applied in order. Rendering is a fold over a
  prefix, so seeking backwards and playing forwards are the same computation and
  cannot disagree.

## Alternatives considered

### Canvas 2D with an absolutely-positioned DOM math layer (the plan's option B)
- **Pros:** One familiar drawing API for the annotations. Cheap to animate.
- **Cons:** It does not remove the DOM math layer — it *adds* a second
  coordinate system beside it, and every annotation must be positioned in canvas
  pixels against boxes measured in DOM pixels. Two systems to keep in sync
  across resize, zoom and device pixel ratio. AC 11's "the canvas contents are
  identical" also becomes a claim about two layers rather than one.
- **Rejected because:** it carries all of the DOM layer's complexity and adds a
  synchronisation problem, in exchange for a drawing API that SVG already
  provides declaratively.

### Inline SVG with `<foreignObject>` for the mathematics (the plan's option A)
- **Pros:** One element tree. The plan's own suggestion.
- **Cons:** `foreignObject` is the least reliable corner of SVG — historically
  poor sizing behaviour, inconsistent measurement, and rendering differences
  between engines, all for the privilege of putting HTML inside SVG when the two
  can simply be layered instead. It also inverts the layering: the math becomes
  a guest inside the drawing surface rather than the content the drawing
  annotates.
- **Rejected because:** overlaying an SVG on HTML achieves the identical visual
  result with none of the `foreignObject` risk. This ADR is the plan's option A
  with the nesting turned inside out.

### Server-rendered SVG or images per step
- **Pros:** No client rendering at all; perfectly deterministic.
- **Cons:** A render per step per viewport width, and AC 13 wants two widths at
  least. Playback controls (AC 12) would each be a fetch. It also fails AC 4's
  spirit — not video, but the same "pre-rendered frames" shape the milestone
  exists to avoid.
- **Rejected because:** it trades an interactive lesson for a slideshow.

## Consequences

### Positive
- **No new dependency.** SVG and HTML are the platform; KaTeX is already used
  and now stays entirely server-side.
- The annotation geometry is a pure module, so AC 11 and M4-3's legibility
  measurement are both testable without a browser.
- ADR-0014's stored document is untouched — it was written renderer-agnostic on
  purpose, and this decision confirms that was worth doing.

### Negative / accepted trade-offs
- **Measurement happens at play time**, so the first frame of a step cannot be
  drawn until the placed elements have been laid out. In practice one frame; it
  must not become a visible flash, and the placement layer is therefore rendered
  invisible-but-laid-out rather than absent.
- **Fonts affect geometry.** An annotation's size derives from a measured box,
  so a font that has not loaded yet measures differently. Playback must wait on
  `document.fonts.ready`. This is the one real determinism hazard and it is
  named here so it is designed for rather than discovered.
- **Overlap is still possible.** Nothing in this decision prevents the model
  placing two elements on top of each other; it only makes the overlap
  *measurable*. Whether a layout pass is needed is M4-3, still open.

## Follow-up required
- [ ] **M4-3, placement legibility.** Now unblocked: render the six authored
      scripts in `.scratch/lesson-authoring-result.json` at 375px and 1280px and
      count out-of-bounds elements and illegible overlaps. Threshold in plan
      §9.2: above 5% and a layout pass becomes M4 scope.
- [ ] Confirm `document.fonts.ready` gating removes the font-measurement hazard
      in a real browser.
