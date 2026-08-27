# M2.5 implementation plan — checkpoints, and the foreign-language column

- **Date:** 2026-08-27
- **Spec:** [docs/specs/m2-5-checkpoints.md](../specs/m2-5-checkpoints.md)
- **ADRs:** [0017](../adr/0017-checkpoints-are-a-practiceset-kind-with-a-database-check-constraint.md)
  (the model), [0018](../adr/0018-a-checkpoint-raises-mastery-through-the-existing-sole-writer.md)
  (mastery), [0016](../adr/0016-foreign-language-is-proficiency-banded-not-grade-banded.md)
  (foreign language). Binding and unchanged: 0009 (closed slate), 0010
  (ratchet), 0011 (two-stage grading), 0006 (route handlers).

## Why one plan covers two features

`ExtractedProblem.language` (ADR-0016) has nothing to do with checkpoints. It is
here because both need a Prisma migration against M2 models, and M2's schema is
still unshipped. One migration now beats two later, and applied migrations
cannot be edited — only corrected by another one, which is why the guard hook
blocks touching them. Everything after §1 is checkpoints alone.

## 1. The migration — one, additive, no backfill

```prisma
enum PracticeSetKind { PRACTICE  CHECKPOINT }

model PracticeSet {
  /// ADR-0017. Paired with `extractionId` by a CHECK constraint written by
  /// hand in the migration — it is NOT visible in this file. See that ADR.
  kind         PracticeSetKind @default(PRACTICE)
  extractionId String?
  extraction   Extraction?     @relation(fields: [extractionId], references: [id], onDelete: Cascade)
}

model ExtractedProblem {
  /// ADR-0016. BCP-47-ish, validated against SUPPORTED_LANGUAGES at
  /// persistence, not by the database. Null for every subject but foreign
  /// language, and for every row written before 2026-08-27.
  language String?
}
```

Hand-written tail of the same migration:

```sql
ALTER TABLE "PracticeSet" ADD CONSTRAINT "practice_set_kind_source"
  CHECK (
    ("kind" = 'PRACTICE'   AND "extractionId" IS NOT NULL) OR
    ("kind" = 'CHECKPOINT' AND "extractionId" IS NULL)
  );
CREATE INDEX "PracticeSet_studentProfileId_kind_createdAt_idx"
  ON "PracticeSet" ("studentProfileId", "kind", "createdAt");
```

Existing rows default to `PRACTICE` and already have an `extractionId`, so they
satisfy the constraint without a backfill. The index serves both the eligibility
query (§3) and the per-kind rate limit.

**Verify before writing anything else:** the deletion bijection test still
enumerates every windowed model, and `RETENTION_POLICY` needs no new row —
`PRACTICE_CONTENT` and `ATTEMPT_HISTORY` already name these models (ADR-0017).

## 2. Config — all `ASSUMPTION`, all in `lib/config.ts`

| Constant | Value | Note |
|---|---|---|
| `CHECKPOINT_SIZE` | `8` | Longer than a practice set's 6 because it spans skills; still one sitting. |
| `CHECKPOINT_MIN_SKILLS` | `3` | Below this there is nothing to check across (AC 1). |
| `CHECKPOINTS_PER_DAY` | `2` | Not per hour — a checkpoint is an event, not a drill. |
| `SUPPORTED_LANGUAGES` | `[]` initially | ADR-0016's allowlist. Empty until ACTFL skills land, which keeps `language` inert. |

`MAX_ATTEMPTS_PER_PROBLEM` does not apply to checkpoints: AC 11 caps them at one
attempt, enforced separately in §5.

## 3. Composition — `lib/checkpoints/compose.ts`, pure

Input: the student's `SkillMastery` rows and `CHECKPOINT_SIZE`. Output: an
ordered list of skill codes. No database access — the caller supplies rows, the
same purity split ADR-0016 uses for `candidateSlate`.

1. Eligible skills = mastery rows with `attemptCount > 0` (AC 2 — never a skill
   the student has not practised, which is also M7's no-placement-test rule).
2. Refuse if fewer than `CHECKPOINT_MIN_SKILLS` distinct (AC 1).
3. Order by `lastPracticedAt` ascending — oldest first, because the point is
   retention (AC 3).
4. Take the first `CHECKPOINT_SIZE` distinct skills; if fewer exist, cycle in
   the same order so every eligible skill appears before any repeats.
5. Every skill is already within band, having been generated within band.

Generation reuses `lib/practice/generate.ts`'s call shape with the composed
codes as the closed slate and no `difficultyOffset` ladder — a checkpoint is at
level, not a climb.

## 4. API contract

| | |
|---|---|
| `GET /api/students/[studentId]/checkpoint-readiness` | AC 4. `{ available: boolean, reason: string \| null }`. The only scheduling signal M2.5 ships. |
| `POST /api/students/[studentId]/checkpoints` | Creates the set, schedules generation via `after()`, returns `202` + `PracticeSetDTO`. `requireState` ACTIVE. `rateLimit` on `CHECKPOINTS_PER_DAY` counting `kind: CHECKPOINT` rows. Refuses with a typed code when §3 step 2 fails. |
| `GET /api/practice-sets/[id]` | Unchanged. Already serves both kinds. |
| `POST /api/practice-problems/[id]/attempts` | Unchanged route, two new `requireFlow` branches (§5). |
| `POST /api/practice-problems/[id]/reveal` | `409` when the set is `CHECKPOINT`. |
| `POST /api/practice-sets/[id]/complete` | Unchanged. |
| `POST /api/practice-sets/[id]/retry` | Unchanged — and note it now carries the ACTIVE gate added in `4f25c99`. |

`toPracticeSetDTO` gains `kind`, and `extractionId` becomes nullable in the DTO.
That is a **shared-file change and must land before either track starts**, per
CLAUDE.md's rule about the two engineers touching disjoint files.

## 5. The two behavioural deltas

Both at the route layer, neither in the schema (ADR-0017):

- **Attempts:** `requireFlow` additionally fails when
  `resource.practiceSet.kind === "CHECKPOINT"` and `resource.attempts.length >= 1`
  (AC 11). Needs its own `requireFlowMessage`, and `withAuth` takes one static
  string per gate — so this is the point at which `requireFlowMessage` should
  become a function of the resource. That is a change to `lib/api/handler.ts`,
  the auth wrapper: it lands **alone, in its own commit, before the feature
  work**, with the ordering tests re-run.
- **Reveal:** `409` for a `CHECKPOINT` set, before the attempt-threshold check.

## 6. Slices — six files each, per retro lesson 10

Each is one run for one agent. Do not merge two.

1. ~~**Migration + config.**~~ **DONE 2026-08-27.** Schema, hand-written CHECK,
   index, the four constants, six integration tests proving the database
   rejects both forbidden combinations (and rejects an UPDATE that would break
   the pairing, which the original plan did not think to ask for).

   **Slice 3 was folded into it, unavoidably.** Making `extractionId` nullable
   is not a change the DTO can lag behind by one slice — `pnpm typecheck` fails
   the moment the column moves, because `PracticeSetDTO.extractionId` was
   `string`. Planning them as separate slices was wrong; a schema change and the
   DTO that mirrors it are one deliverable. The plan's own rule still held, in
   the sense that mattered: the shared file landed before any feature work.

2. **`requireFlowMessage` as a function.** `lib/api/handler.ts` only. Re-run
   `tests/unit/lib/api/handler.test.ts`'s ordering assertions.
3. ~~**Shared DTO.**~~ Folded into slice 1 above.
4. **Composition.** `lib/checkpoints/compose.ts` + tests. Pure, no database,
   heaviest test coverage in the milestone.
5. **Backend routes.** Readiness, create, and the two `requireFlow` deltas.
6. **Frontend.** Checkpoint runner and result surface, reusing the practice
   components. AC 13 is the acceptance test that matters: **no child-facing
   payload may contain a value lower than one previously rendered.**
7. **Foreign language column** (independent of 1-6 after the migration):
   extraction prompt and schema report `language`; validate against
   `SUPPORTED_LANGUAGES` at persistence.

## 7. Assumptions to challenge at the retro

- `CHECKPOINT_SIZE = 8` and `CHECKPOINTS_PER_DAY = 2` are guesses with no data
  behind them.
- Oldest-practised-first ordering assumes time since practice is the best proxy
  for decay. It is the best one available without M7's scheduler, and it is a
  proxy.
- One attempt per checkpoint problem (AC 11) is the sharpest product call in the
  milestone. If it reads as punishing rather than as "this one is a check", that
  shows up here first.
