# ADR-0014: A LessonScript is one validated JSON document on a version row, over a closed primitive vocabulary and a normalised canvas

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m4-whiteboard-lessons.md

## Context

M4 is a shallow-designed milestone — three of its open questions are unmeasured
technical unknowns and the plan deliberately does not fix its API contract. But
the **schema** must be designed now, with M2, M3, M5, M6 and M7, because a
migration is immutable once applied and because M5's narration hangs directly off
whatever shape a script has.

What the criteria pin down:

- **AC 1** — a `LessonScript` that validates against the project's zod schema,
  persisted with the source problem id, the model id, the effort setting and the
  prompt version.
- **AC 2** — a failed schema validation (`parsed_output` null) means status
  `FAILED` and **zero steps persisted. No partial script is written.**
- **AC 3** — a drawing operation whose `kind` is not in the renderer's supported
  vocabulary is **rejected and not persisted**. *"The vocabulary is closed on
  purpose: an unrenderable script must fail at authoring time, never as a blank
  canvas in front of a child."*
- **AC 7** — every step carries a start offset in milliseconds and a duration,
  and *"the player takes that timeline from an injectable cue source rather than
  computing it inline. M5 replaces the cue source with narration timings; if the
  player owns the timing, M5 becomes a rewrite."*
- **AC 8** — step count inside configured bounds, narration per step inside a
  character cap. *"The narration cap exists so M5 never has to split a step
  across two TTS requests."*
- **AC 11** — the same script played twice on the same viewport produces
  identical canvas contents at the end of each step. Deterministic: no randomness,
  no wall-clock-dependent layout.
- **AC 12** — stepping backward to step *k* produces the same canvas as playing
  forward to step *k*.
- **AC 13** — at 375 px and at 1280 px every drawn element is fully within bounds.
  *"Script coordinates are in a normalised logical space, not pixels."*
- **AC 19** — asking for a different explanation authors a **new version**, and
  the previous version **remains playable**.
- **AC 21** — profile deletion removes lessons, script versions and flags; source
  problem deletion removes the lesson with it.

And two things the spec asks us **not** to close off: cross-student lesson reuse
(*"Do not design the script row so that it can never be shared"*), and M5's
narration seam.

`docs/research/anthropic-api.md` §3 sketches the primitives (`write(latex, at)`,
`circle(target)`, `arrow(from, to)`) and establishes the mechanism —
`messages.parse()` with `zodOutputFormat`, `parsed_output` null on failure.
M4's open questions add: the real vocabulary probably also wants underline,
strikethrough, brace, number line, grid and a way to reference a previously
written element by id, and the set *"must be fixed before authoring prompts are
written, because widening it later invalidates every stored script."*

## Decision

We will store a lesson script as **one zod-validated JSON document in a single
`Json` column on a `LessonScriptVersion` row**, over a **closed discriminated
union of drawing primitives**, in a **normalised 0–1 logical canvas**, with
**element ids** as the only way one step refers to another's output.

### 1. Two tables, not three

```prisma
model Lesson {
  id                 String  @id
  studentProfileId   String
  extractedProblemId String?      // exactly one of these two (AC 5, AC 21)
  practiceProblemId  String?
  status             LessonStatus // PENDING | AUTHORING | READY | FAILED  (AC 6)
  currentVersionId   String? @unique
  versions           LessonScriptVersion[]
}

model LessonScriptVersion {
  id            String       @id
  lessonId      String
  version       Int
  status        LessonStatus
  script        Json?        // NULL until READY
  schemaVersion String       // which primitive vocabulary this validates against
  stepCount     Int?
  totalDurationMs Int?
  model         String       // AC 1
  effort        String       // AC 1
  promptVersion String       // AC 1
  failureCode   String?
  inputTokens   Int?
  outputTokens  Int?
  @@unique([lessonId, version])
}
```

`Lesson` is the stable handle bound to a problem; `LessonScriptVersion` is one
authoring run. AC 19 is an insert with `version + 1` and a `currentVersionId`
repoint — the previous row is untouched and stays playable.

**Steps are not rows.** The script is authored atomically, is never edited (a
stated non-goal), and is always read whole for playback. AC 2's "zero steps
persisted" is then not a transaction to get right but a **non-event**: `script`
is simply left null and `status` is `FAILED`.

### 2. The document shape

`lib/lessons/script-schema.ts` — one zod schema that is simultaneously the model's
output format, the persistence validator and the TypeScript type, exactly as
ADR-0005 established for extraction.

```ts
export const LESSON_SCHEMA_VERSION = '1';   // bump = new vocabulary generation

const Point = z.object({ x: z.number().min(0).max(1),
                         y: z.number().min(0).max(1) });   // AC 13

const ElementId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

// AC 3: a CLOSED discriminated union. An unknown `kind` fails parsing.
const DrawOp = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('write'),     id: ElementId, latex: z.string().max(200), at: Point, size: z.enum(['sm','md','lg']) }),
  z.object({ kind: z.literal('label'),     id: ElementId, text:  z.string().max(120), at: Point }),
  z.object({ kind: z.literal('circle'),    id: ElementId, target: ElementId }),
  z.object({ kind: z.literal('underline'), id: ElementId, target: ElementId }),
  z.object({ kind: z.literal('strike'),    id: ElementId, target: ElementId }),
  z.object({ kind: z.literal('arrow'),     id: ElementId, from: ElementId, to: ElementId, curve: z.enum(['straight','arc']) }),
  z.object({ kind: z.literal('brace'),     id: ElementId, from: ElementId, to: ElementId, label: z.string().max(60).nullable() }),
  z.object({ kind: z.literal('highlight'), id: ElementId, target: ElementId }),
]);

const LessonStep = z.object({
  id:        ElementId,                                  // stable; M5 cues key off it, AC 18 flags point at it
  narration: z.string().min(1).max(NARRATION_CHAR_CAP),  // AC 8 — text only, nothing speaks it
  ops:       z.array(DrawOp).min(1).max(LESSON_MAX_OPS_PER_STEP),
  durationMs: z.number().int().min(LESSON_MIN_STEP_MS).max(LESSON_MAX_STEP_MS),
});

export const LessonScriptSchema = z.object({
  title: z.string().max(120),
  steps: z.array(LessonStep).min(LESSON_MIN_STEPS).max(LESSON_MAX_STEPS),   // AC 8
});
```

**Eight primitives.** All 2D, all addressable by `id`, all referring to earlier
elements by id rather than by coordinate. That is the M4 open question's
assumption, made concrete — and it is **provisional until the measurement in the
plan's §9 says the model can author useful lessons within it.** The vocabulary
must be frozen before authoring prompts are written; freezing it before it has
been measured would be worse.

**`startOffsetMs` is derived, not authored.** AC 7 requires each step to carry a
start offset. Asking the model for both offsets and durations invites an
inconsistent timeline (step 3 starting before step 2 ends), which no schema
constraint catches. The model authors `durationMs` per step; offsets are the
running sum, computed once at persistence time and stored in `totalDurationMs`
plus recomputed by the cue source. One source of truth, monotonic by
construction.

### 3. `schemaVersion` on the row, and why

The vocabulary is closed, and M4's own open question says widening it later
"invalidates every stored script". `LessonScriptVersion.schemaVersion` records
which generation a document was written against. The player refuses a
`schemaVersion` it does not implement and offers a regeneration — the concrete
alternative to AC 3's "blank canvas in front of a child", applied to the case
where *we* changed rather than the model.

Without this column, widening the vocabulary is a silent, unbounded correctness
risk across every stored lesson. With it, it is a one-line check.

### 4. Normalised coordinates and a deterministic renderer

All coordinates are 0–1 on both axes. The renderer maps to pixels at play time
against the actual viewport, which is what makes AC 13 (375 px and 1280 px)
achievable at all — the model never sees a pixel.

Determinism (AC 11, AC 12) follows from two rules the renderer must obey:

- **Rendering is a pure function of `(script, stepIndex, viewport)`.** No
  incremental mutation of a retained canvas. Stepping to *k* re-renders steps
  `0..k` from scratch, which makes AC 12 true by construction rather than by
  maintaining an undo stack.
- **No randomness and no wall-clock input to layout.** Animation is an
  interpolation parameter passed in, not read from `Date.now()` inside the
  renderer.

**The renderer target is deliberately undecided.** Canvas 2D cannot draw KaTeX
output, which is HTML and CSS — and AC 14 requires mathematics to render as
mathematics using M1's LaTeX convention. The realistic candidates are inline SVG
with `foreignObject`, or a canvas with an absolutely-positioned DOM math layer.
Both satisfy the schema above unchanged; only one of them will survive contact
with `prefers-reduced-motion` (AC 15) and the text view (AC 16). Choosing before
measuring would be choosing on no evidence, so the plan's §9 makes it a
measurement and this ADR does not pre-empt it. **What matters here is that the
stored document is renderer-agnostic**, which is what makes the choice
reversible.

### 5. The cue source seam (AC 7, and the whole of M5's cost)

The player never computes timing. It takes:

```ts
export interface CueSource {
  cueFor(stepId: string): { startOffsetMs: number; durationMs: number };
  totalDurationMs(): number;
}
```

M4 ships `ScriptCueSource` — the running sum of authored `durationMs`. M5 ships
`NarrationCueSource`, built from `LessonNarration` rows derived from the TTS
provider's character-level alignment (`docs/research/elevenlabs-tts.md` §3). The
player does not change.

`LessonStep.id` is the join key, which is why it is a stable authored id rather
than an array index: an array index changes if a regeneration produces a
different step count, and M5's cues and AC 18's flags would both silently point at
the wrong step.

`NARRATION_CHAR_CAP` is enforced by the authoring schema (AC 8) so M5 never has
to split a step across two TTS requests — the TTS models cap requests at
3,000–40,000 characters depending on model, and a split line is a split alignment,
which is an unfixable sync bug.

### 6. Not designing out cross-student reuse

The spec asks that the script row not be shaped so it can never be shared. It
already is not: `LessonScriptVersion` has **no `studentProfileId`**. Ownership
runs through `Lesson`, and the document itself carries no identifier — only the
problem's numbers, which is a privacy question (a script authored from one child's
worksheet contains their specific values) and not a schema one.

Sharing later means adding a nullable `sharedFromVersionId`, or promoting a
version to a skill-scoped library row. Neither requires touching the document
format. **We are not building it and not deciding it** — M4 forbids reuse
outright — but nothing here blocks it.

## Alternatives considered

### Normalise steps and draw ops into `LessonStep` / `LessonDrawOp` tables
- **Pros:** Queryable ("how often does the model use `brace`?"). Foreign keys
  from `LessonNarration` and `LessonFlag` to a real step row. Each op's shape is
  a column, so the database enforces some of the schema.
- **Cons:** A discriminated union of eight shapes across two tables is either
  eight nullable column groups or a polymorphic `payload Json` — which is the
  JSON document again, with joins. AC 2's "zero steps persisted" becomes a
  transaction to get right instead of a null column. The script is never queried
  by step, never edited, and always read whole. And the analytics motivation is
  answerable from the JSON with one Postgres `jsonb` query.
- **Rejected because:** it buys integrity we already get from zod at the only
  write site, and costs the one property that makes AC 2 trivial.

### A `scriptVersion Int` column on `Lesson`, with the script overwritten
- **Pros:** One table. Simplest possible model.
- **Cons:** AC 19 requires the previous version to **remain playable**. An
  overwrite destroys it, and a child who preferred the first explanation cannot
  get it back.
- **Rejected because:** it fails AC 19 literally.

### Let the model emit arbitrary SVG, or a drawing DSL as a string
- **Pros:** Unlimited expressiveness. No vocabulary to design or freeze. Models
  are decent at SVG.
- **Cons:** Model-authored SVG rendered into a page is untrusted markup in front
  of a child — a sanitisation problem we would own forever. It is unstyleable,
  unnarratable (no steps to attach cues to), untranslatable, and it directly
  contradicts the "lesson as data, not a rendered artifact" engineering user
  story. AC 3's whole point is that an unrenderable instruction must fail at
  authoring time; arbitrary markup has no failure mode short of rendering
  nothing.
- **Rejected because:** it is a security surface and it destroys every seam M5,
  M7 and the text view depend on.

### An open vocabulary — accept unknown `kind`s and skip them at play time
- **Pros:** The model is never blocked. New primitives can be added without
  invalidating stored scripts.
- **Cons:** A skipped op is a missing step in an explanation, invisible to
  everyone except the child looking at a gap. AC 3 forbids it in terms and
  explains why.
- **Rejected because:** the AC forbids it and the failure lands on a child.

### Pixel coordinates against a fixed 1280×720 logical canvas, scaled at play time
- **Pros:** More intuitive to author, and probably better model output because
  pixel geometry is well represented in training data.
- **Cons:** Equivalent to normalised coordinates under a linear map, so it buys
  nothing structural — but it invites aspect-ratio bugs when the player's box is
  not 16:9, and it tempts the renderer into treating a coordinate as a pixel on
  one path and a ratio on another. AC 13 names normalised space explicitly.
- **Rejected because:** it is the same thing with more ways to go wrong, and the
  spec names the alternative.

### Author `startOffsetMs` as well as `durationMs`
- **Pros:** Directly satisfies AC 7's wording. The model could express a
  deliberate pause between steps.
- **Cons:** Two authored numbers that must agree, with no schema constraint able
  to express "offset[k] == offset[k-1] + duration[k-1]". The first inconsistent
  timeline renders a step over the previous one.
- **Rejected because:** a derived offset cannot be inconsistent, and AC 7 asks
  that the step *carry* an offset, not that a model author it.

## Consequences

### Positive
- AC 2 is free: a failed parse leaves `script` null. There is no partial state
  because there is nothing to partially write.
- AC 3 is a zod discriminated union — the same object that constrains the model's
  output, so an unrenderable script mostly cannot be generated, and definitely
  cannot be persisted.
- AC 12 is free: re-rendering `0..k` from a pure function makes backward stepping
  and forward playing identical by definition, with no undo stack to desynchronise.
- AC 19 is an insert. The old row is byte-identical afterwards, which is the same
  append posture ADR-0007 took for consent.
- M5 is an addition, not a rewrite: the cue interface, the stable step ids and the
  narration character cap are all in place before any TTS code exists.
- The renderer target stays reversible, because the stored document knows nothing
  about pixels, SVG or canvas.

### Negative / accepted trade-offs
- **A `Json` column is opaque to the database.** No constraint, no index on step
  content, and a schema change is a code change with no migration to force the
  issue. `schemaVersion` is the mitigation and it only works if the player
  actually checks it.
- **Eight primitives is a guess.** It is the spec's assumption made concrete, and
  it is frozen before the measurement that would justify it — deliberately, since
  the prompts cannot be written otherwise, but it means the first real
  measurement may force a `schemaVersion` bump before a single lesson has shipped.
- **The vocabulary is unashamedly maths-shaped.** A reading-comprehension lesson
  drawn with `circle`, `arrow` and `brace` is a different design, and the spec's
  answer — refuse cleanly, fall back to text — is the right one but it means the
  whiteboard covers a minority of subjects.
- **Element-id references make the model responsible for referential integrity.**
  `circle({ target: 'step3_numerator' })` where that id was never written is a
  valid document that draws nothing. zod cannot express it; a post-parse
  validation pass must, and it is the one place AC 3's spirit is enforced outside
  the schema.
- Every authored `durationMs` is a guess by a model with no sense of pacing.
  M5 replaces them with real audio lengths, which means the silent lesson and the
  narrated lesson of the same script are paced differently. Accepted.

### Follow-up required
- [ ] **Do not write authoring prompts until the plan's §9 measurements are
      done** — vocabulary sufficiency, placement legibility at 375 px, authoring
      latency, and whether the final written expression matches the answer key
      (AC 17). This ADR fixes the *shape*; the measurements fix the *contents*.
- [ ] Decide the renderer target (SVG `foreignObject` vs canvas + DOM math layer)
      from the prototype, and record it as a new ADR — it may need a dependency.
- [ ] A post-parse validation pass asserting every `target`/`from`/`to` id refers
      to an element written in an earlier or the same step, and that step ids are
      unique. Reject the script if not; this is AC 3's real teeth.
- [ ] A determinism test: render the same fixture script twice at each viewport
      and compare the serialised output at every step boundary (AC 11), and
      compare step-back-to-*k* against play-forward-to-*k* (AC 12).
- [ ] Add `LESSON_SCRIPT` and `PLAYBACK_EVENT` rows to M0's `RETENTION_POLICY`
      before M4 ships. M4's spec says both are missing and says to default to
      collecting less on playback events.
- [ ] Decide whether `LessonPlayback` is worth having at all. It is an engagement
      log about a minor with no business need stated beyond product analytics,
      which is exactly what §312.10 is aimed at.

## Revisit when

The §9 measurements come back and the eight-primitive set proves insufficient (a
`schemaVersion` bump, before any lesson has shipped, is cheap; after is not); or
the renderer target is chosen and turns out to constrain the document format; or
cross-student reuse becomes a real product goal, at which point the privacy
question — a script containing one child's numbers replayed for another — is the
decision, not the schema.
