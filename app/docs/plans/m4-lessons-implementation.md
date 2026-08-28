# M4 implementation plan — whiteboard lessons

- **Date:** 2026-08-28
- **Spec:** [m4-whiteboard-lessons.md](../specs/m4-whiteboard-lessons.md) (22 AC)
- **ADRs:** [0014](../adr/0014-lessonscript-as-one-versioned-validated-json-document.md) (the document), [0019](../adr/0019-lessons-render-as-positioned-html-under-an-svg-annotation-overlay.md) (the renderer)
- **Measurements:** [m4-authoring-measurement.md](../research/m4-authoring-measurement.md) — all five of plan §9.2 have returned

This is the contract §9.2 said could not be written until the measurements
returned. Every shape below is chosen against a measured number, and where a
number is missing that is said rather than glossed.

**Already built** (commit `7249ea9`): `lib/lessons/script-schema.ts`,
`validate.ts`, `layout.ts`, a provisional `prompt.ts`, and the live measurement
harness. What follows is everything else.

## 0. The four decisions the measurements made

1. **Authoring is a background job, not an in-request call.** 12-59s measured,
   p50 35s. `after()` runs for the route's `maxDuration`, so **no queue** — the
   same shape `run-extraction.ts` and `generate.ts` already use.
2. **The primitive vocabulary freezes at eight.** 0 schema rejections over six
   fixtures spanning four subjects. Provisional: six is not the twenty §9.2
   asked for, and `strike` is still unexercised. `LESSON_SCHEMA_VERSION` makes
   the decision reversible at a known cost.
3. **The renderer is positioned HTML under an SVG overlay** (ADR-0019), with
   LaTeX server-rendered. No KaTeX in the browser.
4. **No deterministic layout pass.** 0 of 6 scripts had an out-of-bounds element
   or an illegible overlap. Labels must wrap, which is a renderer concern, not a
   layout-engine one.

## 1. The migration — one, additive, no backfill

```prisma
enum LessonStatus { PENDING  AUTHORING  READY  FAILED }

model Lesson {
  id                 String  @id @default(cuid())
  studentProfileId   String
  /// AC 5 / AC 21: bound to exactly ONE. Same hand-added CHECK as ChatSession —
  ///   CHECK (num_nonnulls("extractedProblemId", "practiceProblemId") = 1)
  /// invisible in this file; its integration test is its documentation.
  extractedProblemId String?
  practiceProblemId  String?
  status             LessonStatus @default(PENDING)
  /// AC 19. Repointed on each successful regeneration; the old row stays playable.
  currentVersionId   String?  @unique
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  studentProfile   StudentProfile   @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  extractedProblem ExtractedProblem? @relation(fields: [extractedProblemId], references: [id], onDelete: Cascade)
  practiceProblem  PracticeProblem?  @relation(fields: [practiceProblemId],  references: [id], onDelete: Cascade)
  versions         LessonScriptVersion[]
  flags            LessonFlag[]

  @@index([studentProfileId, createdAt])
  /// The reaper for a stale AUTHORING row, the same query `reapIfStale` uses.
  @@index([status, updatedAt])
}

model LessonScriptVersion {
  id              String       @id @default(cuid())
  lessonId        String
  version         Int
  status          LessonStatus
  /// AC 2: NULL until READY. "Zero steps persisted" is then a non-event.
  script          Json?
  schemaVersion   String
  stepCount       Int?
  totalDurationMs Int?
  model           String       // AC 1
  effort          String       // AC 1
  promptVersion   String       // AC 1
  failureCode     String?
  inputTokens     Int?
  outputTokens    Int?
  createdAt       DateTime     @default(now())

  lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  @@unique([lessonId, version])
}

/// AC 18.
model LessonFlag {
  id        String   @id @default(cuid())
  lessonId  String
  versionId String
  /// Null when the student flagged the lesson rather than a step.
  stepIndex Int?
  reason    String   // from a fixed client-side allowlist, not free text
  createdAt DateTime @default(now())

  lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  @@index([lessonId, createdAt])
}
```

**`reason` is an allowlist, not free text, and that is a COPPA call.** A free-
text box on a child-facing surface is a new channel for unbounded personal data,
with a retention row and a §312.4 notice line behind it. Four fixed reasons —
*confusing*, *too fast*, *this is wrong*, *not my problem* — carry the signal
AC 18 needs at none of that cost.

**Migration mechanics.** `--create-only`, hand-add the CHECK, then apply. The M3
lesson applies: the plan's SQL must use camelCase, because Prisma generates
camelCase. `SHADOW_DATABASE_URL` must be passed per command until `.env` is
fixed — see CLAUDE.md > Databases.

## 2. Config — `lib/config.ts`

Already added: `LESSON_SCHEMA_VERSION`, `LESSON_MIN_STEPS`/`MAX_STEPS`,
`NARRATION_CHAR_CAP`, `LESSON_MAX_OPS_PER_STEP`, `LESSON_MIN_STEP_MS`/`MAX_STEP_MS`,
`LESSON_MODEL`, `LESSON_EFFORT`.

Still to add:

| Constant | Value | Why |
|---|---|---|
| `LESSONS_PER_HOUR` | 6 | AC 22. Per profile, matching every other cap. A lesson is the most expensive call in the app — 59s and 4.5k output tokens at the top of the measured range. |
| `LESSON_AUTHORING_TIMEOUT_MS` | 120_000 | AC 10. Twice the measured worst case, matching `EXTRACTION_TIMEOUT_MS`. |
| `MAX_LESSON_VERSIONS` | 5 | AC 19 is unbounded as written; regeneration is the most expensive loop a child can drive. |
| `LESSON_LABEL_MAX_WIDTH` | 0.42 | ADR-0019. The normalised width at which a `label` wraps — the 65-character finding. |

## 3. API contract — FIXED once approved

Continuing the numbering, which ended at 39.

| # | Route | Method | Auth | Input | Success | Error |
|---|---|---|---|---|---|---|
| 40 | `/api/extracted-problems/[problemId]/lessons` | POST | **Owner+ACTIVE** | `z.object({}).strict()` | `202 { lesson: LessonDTO }`, `PENDING`. Row written **before** the AI call — it is the rate-limit grant. Authoring scheduled with `after()` | **403** non-`ACTIVE` · **404** cross-account (AC 20) · **409** extraction not `CONFIRMED`, **or the student has no attempt and no chat session on it (AC 5)** · **429** above `LESSONS_PER_HOUR`, no AI call (AC 22) |
| 41 | `/api/practice-problems/[problemId]/lessons` | POST | **Owner+ACTIVE** | `z.object({}).strict()` | as #40, bound to the practice problem | as #40, with "no attempt on this problem" as the AC 5 gate |
| 42 | `/api/lessons/[lessonId]` | GET | Owner | — | `200 LessonDetailResponse` — the lesson, its current version, and the script **only when `READY`**. Polled while `PENDING`/`AUTHORING`. Lazily fails a stale `AUTHORING` row past the timeout, the `reapIfStale` pattern | 401 · 404 (AC 20) |
| 43 | `/api/lessons/[lessonId]/versions` | POST | Owner+ACTIVE | `z.object({}).strict()` | `202 { lesson: LessonDTO }` — a NEW version at `version + 1`, `PENDING`. The previous version row is untouched and stays playable (AC 19) | 400 · 401 · 403 · 404 · **409** if a version is already `PENDING`/`AUTHORING`, or at `MAX_LESSON_VERSIONS` · **429** |
| 44 | `/api/lessons/[lessonId]/versions/[versionId]` | GET | Owner | — | `200 LessonVersionDTO`. AC 19's "previous version remains playable" needs an address of its own | 401 · 404 |
| 45 | `/api/lessons/[lessonId]/flags` | POST | Owner+ACTIVE | `z.object({ versionId: z.cuid(), stepIndex: z.number().int().min(0).nullable(), reason: z.enum(LESSON_FLAG_REASONS) }).strict()` | `201 { flag: LessonFlagDTO }` (AC 18) | 400 · 401 · 403 · 404 |

**Six endpoints. No "record playback" route**, which plan §3.5 sketched: no AC
asks for it, M7 owns activity tracking, and a route with no consumer is a
retention obligation nobody has scoped.

### DTOs — `lib/schemas/dto.ts`

```ts
export type LessonDTO = {
  id: string;
  status: LessonStatus;
  subject: { kind: 'EXTRACTED_PROBLEM' | 'PRACTICE_PROBLEM'; id: string };
  currentVersionId: string | null;
  versionCount: number;
  /// From a fixed allowlist only. Never a model id or provider payload (AC 10).
  failureMessage: string | null;
  createdAt: string;
};

export type LessonVersionDTO = {
  id: string; version: number; status: LessonStatus;
  /// NULL unless READY. Ops carry `latexHtml`, server-rendered (ADR-0019 §3).
  script: RenderableLessonScript | null;
  stepCount: number | null; totalDurationMs: number | null;
  /// AC 7: derived at persistence, never authored.
  timeline: { stepId: string; startOffsetMs: number; durationMs: number }[] | null;
  // NOTE: model, effort, promptVersion, failureCode and token counts are NEVER in a DTO.
};

export type LessonDetailResponse = { lesson: LessonDTO; version: LessonVersionDTO | null };
```

`RenderableLessonScript` is the stored script with each `write` op's `latex`
accompanied by a server-rendered `latexHtml`. **The raw `latex` stays** — AC 16's
text view needs something readable, and a screen reader should not be handed
KaTeX markup.

## 4. Component tree

```
app/(app)/lessons/[lessonId]/page.tsx          server  DAL load; notFound() on null (AC 20).
                                                       Renders latexHtml server-side.
  components/lessons/authoring-state.tsx       CLIENT  polls #42 while PENDING/AUTHORING (AC 6)
  components/lessons/failed-lesson.tsx         server  AC 10 plain message + retry (#43)
  components/lessons/lesson-player.tsx         CLIENT  the fold over steps 0..k; owns nothing else
    components/lessons/stage.tsx               CLIENT  placement layer + SVG overlay (ADR-0019)
    components/lessons/player-controls.tsx     CLIENT  AC 12 play/pause/step/replay
  components/lessons/lesson-text-view.tsx      server  AC 16 — a SIBLING, not a mode
  components/lessons/flag-lesson.tsx           CLIENT  AC 18, four fixed reasons

components/lessons/request-lesson-button.tsx   CLIENT  #40 or #41 — ITS OWN SLICE
```

**`CueSource` (AC 7).** The player takes its timeline from an injected cue
source, never computing it inline: `lib/lessons/cues.ts` exports
`staticCueSource(timeline)` for M4, and M5 replaces it with narration timings.
If the player owns the timing, M5 is a rewrite — the spec says so explicitly.

**AC 15, reduced motion.** Animation is a CSS transition on the placement layer
and a stroke reveal on the overlay, both added on top of a static final frame.
Honouring the preference *removes* effects; there is no second rendering path
that could diverge from the first.

**AC 12, stepping.** The canvas at step *k* is the ops of steps 0..*k* folded in
order. Seeking backwards and playing forwards are literally the same
computation, so they cannot disagree.

## 5. Slices — six files each, per retro lesson 10

| # | Slice | Files |
|---|---|---|
| 1 | **Migration + DTOs** | `schema.prisma`, the migration (hand-edited CHECK), `lib/schemas/dto.ts`, `lib/schemas/lesson.ts`, `lib/lessons/dto.ts`, its test |
| 2 | **Authoring service** | `lib/lessons/author.ts` (the status machine + `reapIfStale`), `lib/errors.ts` (`LESSON_FAILURE_*`), `lib/config.ts`, `lib/ai/outbound` wiring, two tests |
| 3 | **Routes 40-42** | two request routes, the GET, `lib/auth/dal.ts` helpers, two route tests |
| 4 | **Routes 43-45** | versions POST/GET, flags POST, `lib/schemas/lesson.ts`, two route tests |
| 5 | **Cascades** | `tests/integration/lesson-deletion-cascade.test.ts` — **its own slice, per retro lesson 19.** Both bindings, profile deletion, counts not ids |
| 6 | **Stage + geometry** | `stage.tsx`, `cues.ts`, `lesson-player.tsx`, tests |
| 7 | **Controls, text view, flag** | `player-controls.tsx`, `lesson-text-view.tsx`, `flag-lesson.tsx`, `failed-lesson.tsx`, tests |
| 8 | **The entry point** | `request-lesson-button.tsx`, wired into the practice runner and the chat surface, plus the page — **its own named slice, per retro lesson 15** |
| 9 | **M4-3 for real** | Playwright at 375px and 1280px over the six authored scripts |

**Deliberately NOT in these slices: extracting the generic status machine.**
Plan §3.5 is right that this is the third instance and it should become one. It
should not happen *while* the third is being written — that refactors two
shipped milestones on top of an unshipped one. It is a follow-up slice once M4
is green.

## 6. Assumptions to challenge at the retro

- **Six fixtures froze an eight-primitive vocabulary.** §9.2 asked for twenty.
  If authoring quality disappoints in real use, this is the first place to look,
  and `strike` has still never been exercised.
- **`LESSONS_PER_HOUR = 6`** is a guess. It is the most expensive call in the
  app and the only cap set without a usage number behind it.
- **The AC 5 gate ("must have attempted it") is enforced but unmeasured.** It
  exists so lessons are not a do-my-homework machine. Nobody has checked whether
  it is the *right* gate or merely a plausible one.
- **Lessons for non-maths subjects are now in scope**, against the spec's own
  assumption. The reading fixture authored the best lesson of the six. If that
  does not hold at n=20, the spec's fallback-to-text position returns.
