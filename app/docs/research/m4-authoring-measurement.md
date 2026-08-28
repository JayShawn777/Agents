# M4 authoring — the measurements that gate the contract

- **Date:** 2026-08-28
- **Milestone:** M4 (interactive whiteboard lessons)
- **Runs:** `tests/unit/live/lesson-authoring.live.test.ts`, `RUN_LIVE_AI=1`
- **Model / effort:** `claude-opus-5` at `LESSON_EFFORT = "high"`
- **Sample:** 6 fixture problems, one authoring run each, plus one re-run

Plan §9.2 says **"M4's contract must not be written until these return."** Three
of its five measurements come from these runs. This file is what returned.

**Read the sample size before the conclusions.** The plan specifies 20 fixtures
at two effort levels with five runs each; this is six fixtures at one effort,
run once. It is enough to kill or keep the big architectural questions, and it
is not enough to freeze a vocabulary forever. Where that distinction matters it
is stated.

## M4-1 — authoring latency. **The in-request design is dead; a queue is not needed.**

| Fixture | Subject | Wall clock | Output tokens |
|---|---|---|---|
| two-step-equation | MATH | 12.3s | 1,171 |
| fractions-add-like | MATH | 16.5s | 1,174 |
| ela-topic-sentence | READING | 29.8s | — |
| science-food-chain | SCIENCE | 34.7s | 2,979 |
| history-timeline | HISTORY | 39.1s | 3,176 |
| decimals-align | MATH | **59.0s** | 4,569 |

p50 ≈ 34.7s. Worst observed **59.0s**, on the *simplest-looking* problem in the
set — adding two decimals produced the longest lesson, because a careful
explanation of decimal alignment has more steps than solving `3x + 5 = 20`.
Problem difficulty is not a proxy for authoring cost, so no "only long lessons
are slow" shortcut is available.

**This is 10-20x a chat turn** (M3 measured 2.2-2.9s end to end). Authoring
cannot run inside the student's request: a child would sit on a spinner for up
to a minute with no feedback, and at 59s the run is close enough to a 60s
platform ceiling that the failure would be a timeout rather than a slow success.

**But the plan's expensive branch is avoided.** §9.2 says "if that is not
enough, a job queue enters M4 — a new dependency, a new approval and a new
operational surface". It is not needed: `after()` runs for the route's
configured `maxDuration`, which M3 already sets to 300 on its streaming route,
and 59s fits inside that with a wide margin. So M4 gets the **same shape
extraction and practice generation already use** — write the row, return
`202 PENDING`, schedule the authoring with `after()`, poll — and AC 6's status
machine stops being a hedge and becomes the design.

Plan §3.5 already anticipated this: it is the **third** instance of that status
machine, "at which point it should be extracted into one generic".

## M4-4 — vocabulary sufficiency. **Eight primitives held, including for non-maths.**

- **0 schema rejections** across all six.
- **0 refusals.**
- **6 of 6 referentially clean** — every `circle`/`arrow`/`brace` pointed at an
  element defined earlier. `lib/lessons/validate.ts` found nothing to complain
  about, which is a better result than expected for a first prompt.
- **7 of the 8 primitives were used.** Only `strike` never appeared, which is
  unsurprising: none of these six problems involves crossing out wrong work.

**The finding that matters most is the non-maths one.** M4's own open question
concedes the vocabulary is "unashamedly math-shaped" and assumes lessons would
be "math and science only at first, other subjects fall back to text". That
assumption looks wrong, in the good direction:

- **READING** (find the topic sentence) produced a six-step lesson that split
  the paragraph into its three sentences with `label`, stated the rule,
  `highlight`ed each candidate in turn, used `arrow` to connect each detail back
  to the main idea, and `underline`d the answer. It reads like something a
  teacher would put on a board.
- **HISTORY** (order three events on a timeline) authored seven clean steps.
- **SCIENCE** (a food chain) authored eight.

This project has already had one near-miss where every test used a maths problem
and the product quietly became a maths app. The fixture set was built to make
that failure visible if it were there. It was not.

**Recommendation: freeze the vocabulary at eight — provisionally, and say so.**
Six fixtures is not twenty. The honest position is that nothing yet argues for
widening it, `strike` is unexercised, and `LESSON_SCHEMA_VERSION` exists exactly
so the decision is reversible at a known cost.

## M4-5 — answer correctness. **3 of 3, on the three with known keys.**

Every fixture with an answer key ended on it: `\frac{2}{4}`, `16.15`, and `x=5`
as the final `write` op. The three non-maths fixtures have no single correct
final expression and were not graded.

Too small to claim the 100% AC 17 wants. It does mean no authoring-time
verification pass is *obviously* required yet — §9.2's fallback if this had
failed.

## An unplanned finding: transience is a real failure mode

One of the six runs failed after **363ms** with a bare `Error`. Re-run
unchanged, it authored cleanly in 29.8s. So: a transient upstream blip, and at
`maxRetries: 0` (deliberate, ADR-0005 — this app owns retries at the attempt
level, not the HTTP level) it becomes a hard `FAILED` lesson.

One in six is a small sample and almost certainly an overestimate of the true
rate, but it is not zero. **AC 2's "FAILED with a retry option" is therefore
load-bearing rather than decorative**, and the retry must be reachable by the
student in one action — the same `attemptCount` + retry-endpoint shape M1's
extraction already has.

## What this does not say

Six problems, one run each, one effort level, from a development machine rather
than a deployed function. Nothing here measures whether a *child* learns
anything from these lessons, or whether the model authors well from a
photographed worksheet rather than clean typed text.

**M4-2 and M4-3 were run afterwards and are recorded below.** All five of
§9.2's measurements have now returned, so M4's contract is unblocked.

---

## M4-2 — renderer target. **Settled: positioned HTML under an SVG overlay.**

Measured rather than assumed, 2026-08-28:

```
katex.renderToString('\frac{1}{4}')  →  1,363 chars
  contains <svg>:  false
  contains <span>: true   (nested spans + a MathML block)
```

Canvas 2D is therefore out — a browser will not rasterise arbitrary HTML into a
2D context, and re-implementing fraction and radical layout to draw glyphs by
hand is a typesetting project, not a milestone. The full reasoning, including
why this inverts the plan's option A rather than adopting it, is
[ADR-0019](../adr/0019-lessons-render-as-positioned-html-under-an-svg-annotation-overlay.md).

The consequence worth repeating outside the ADR: because a script is authored
and stored **before** anyone plays it, every `write` op's LaTeX is rendered to
HTML on the server, exactly as M1, M2 and M3 already do. **No KaTeX JavaScript
ships to the browser anywhere in this application**, and ADR-0005 now holds with
no exception — the same finding that removed the lazy KaTeX chunk from M3's
chat, arrived at twice.

## M4-3 — placement legibility. **Provisional pass. No layout pass required.**

Run against the six authored scripts, 64 placed elements:

| Script | Placed | Out of bounds | Near edge (<0.05) | Illegible pairs |
|---|---|---|---|---|
| fractions-add-like | 6 | 0 | 0 | 0 |
| decimals-align | 13 | 0 | 1 | 0 |
| two-step-equation | 9 | 0 | 0 | 0 |
| science-food-chain | 13 | 0 | 1 | 0 |
| history-timeline | 13 | 0 | 2 | 0 |
| ela-topic-sentence | 10 | 0 | 1 | 0 |

**0 of 6 scripts** had an out-of-bounds element or an illegible overlap, against
§9.2's threshold of 5%. The model lays work out down the canvas the way it was
asked to, and **a deterministic layout pass — the "real work nobody has scoped"
§9.2 warned about — is not needed.**

**This is an estimate and the definitive run is still owed.** Element widths
come from a rough glyph model, not from a browser. It answers "did the model
stack two things at nearly the same coordinate", which is a coordinate question
and the one that decides whether a layout pass is scope. It does not answer
"does this glyph fit". The real measurement needs the player and Playwright at
375px and 1280px, and is cheap once the player exists.

### The finding the coordinate check nearly hid: long labels

`label` text is not short. Median 24 characters, but the longest the model
produced was **65** — *"3. Their wings are made of skin stretched over long
finger bones."* — and `LessonScriptSchema` permits up to **120**.

At a plausible glyph width, 65 characters spans very nearly the full canvas at
1280px, and cannot fit on one line at 375px at any readable size. So:

- **`label` must have a max width and must wrap.** This is a renderer
  responsibility, not something to push back onto the model with a shorter cap —
  a reading lesson legitimately needs to quote a sentence.
- **Wrapping changes the element's height, which changes every annotation drawn
  around it.** That is fine by construction — ADR-0019 measures the box after
  layout rather than predicting it — but it means the measure-then-draw pass is
  load-bearing rather than an implementation detail, and a renderer that guessed
  box sizes from character counts would be wrong here specifically.

The three maths fixtures would never have surfaced this. The reading fixture did.
