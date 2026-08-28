# ADR-0017: Checkpoints are a `PracticeSet` kind, held together by a CHECK constraint

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m2-5-checkpoints.md

## Context

A checkpoint is a short mixed set drawn from skills a student has worked on
across many uploads over time. Practice, in M2, is generated from exactly one
extraction, and `PracticeSet.extractionId` is a required column with
`onDelete: Cascade` — deleting the worksheet deletes the practice built from it
(M2 AC 25). That cascade is right for practice and wrong for a checkpoint, which
is not built from any single worksheet.

Everything else a checkpoint needs already exists and is reviewed: the closed
skill slate (ADR-0009), the generation call, the two-stage grading path
(ADR-0011), the server-only answer-key table, the `Attempt` model, the mastery
ratchet (ADR-0010), the DTO builders that gate `workedSolution` on `revealed`,
and one `RETENTION_POLICY` row per model with a deletion story.

The M2.5 spec is explicit that this is why the milestone is sequenced before
M3: whatever shape this takes is cheapest now, while M2 is unshipped, and
materially more expensive once four more milestones have built on `PracticeSet`.

## Decision

**We will add a `kind` discriminator to `PracticeSet`, make `extractionId`
nullable, and enforce the pairing with a database CHECK constraint written by
hand into the migration.**

```prisma
enum PracticeSetKind {
  PRACTICE
  CHECKPOINT
}

model PracticeSet {
  kind         PracticeSetKind @default(PRACTICE)
  extractionId String?
  extraction   Extraction?     @relation(fields: [extractionId], references: [id], onDelete: Cascade)
  // ...unchanged
}
```

and, in the same migration, raw SQL Prisma cannot express in the schema:

```sql
ALTER TABLE "PracticeSet" ADD CONSTRAINT "practice_set_kind_source"
  CHECK (
    ("kind" = 'PRACTICE'  AND "extractionId" IS NOT NULL) OR
    ("kind" = 'CHECKPOINT' AND "extractionId" IS NULL)
  );
```

The constraint is the point of the decision, not a detail of it. Making
`extractionId` nullable weakens M2 AC 3 — "practice only ever comes from a
CONFIRMED extraction" — from something the schema guaranteed into something
application code remembers. The CHECK gives the guarantee back, and gives back
more than was there before: it is now impossible to store a checkpoint that
claims a worksheet, as well as impossible to store practice that has none.

This is the same instinct as the 2026-08-27 coverage fix, which replaced two
hand-maintained lists that had drifted with one derived from the other. Three
enforced rules beat thirty advisory ones.

Consequences that follow, and are not separate decisions:

- **Cascade needs no special case.** A checkpoint's `extractionId` is NULL, so
  the extraction cascade cannot reach it. Checkpoints are removed only when the
  student profile is, which matches how `SkillMastery` already behaves
  (ADR-0010 §6) and satisfies M2.5 AC 18's demand for a stated rule rather than
  an accidental one.
- **Checkpoint problems are `PracticeProblem` rows** with `PracticeAnswerKey`
  rows behind them. Every existing control — the DAL's `select`, `dto.ts`'s
  `revealed` gate, the reveal route's attempt threshold — applies unchanged and
  keeps its existing tests.
- **No new retention row is needed.** `PRACTICE_CONTENT` and `ATTEMPT_HISTORY`
  already name these models. M2.5 AC 20's bijection test keeps passing because
  no new model is introduced.
- **Two behavioural differences live at the route layer, not the schema**
  (M2.5 AC 11): the attempts route refuses a second attempt on a problem whose
  set is `CHECKPOINT`, and the reveal route 409s for a `CHECKPOINT` set.

## Alternatives considered

### Separate `Checkpoint` / `CheckpointProblem` / `CheckpointAnswerKey` models
- **Pros:** M2 AC 3's invariant survives untouched; no nullable column; no CHECK.
- **Cons:** Duplicates the answer-key separation, the grading path, the DTO
  builders, the deletion story and the retention rows — and duplicates every
  test that guards them. Two answer-key tables is two chances to leak one.
- **Rejected because:** the controls that protect a child's answer key are the
  most reviewed code in the project, and forking them to avoid one nullable
  column trades a small schema compromise for a large correctness one.

### Keep `extractionId` required; point a checkpoint at an arbitrary extraction
- **Pros:** No migration beyond `kind`; no CHECK; no nullability.
- **Cons:** The column would lie. Deleting that arbitrarily-chosen worksheet
  would cascade away a checkpoint drawn from twelve others.
- **Rejected because:** a foreign key that means "one of the ones this came
  from, roughly" is worse than no foreign key, and it is a data-loss bug
  wearing a schema's clothing.

### `kind` and nullable `extractionId`, enforced only in application code
- **Pros:** Pure Prisma; no raw SQL in a migration.
- **Cons:** This repo has twice written a rule in prose, twice had it broken,
  and twice ended up enforcing it in `guard.mjs` afterwards. The pattern is
  documented in CLAUDE.md.
- **Rejected because:** the enforcement is four lines of SQL and we already know
  how the other version ends.

## Consequences

### Positive
- Checkpoints inherit every reviewed control instead of copying it.
- The extraction invariant is enforced more strongly after this change than
  before it — in both directions rather than one.
- The migration is small and additive: one enum, one nullable column, one
  constraint, no backfill beyond defaulting existing rows to `PRACTICE`.

### Negative / accepted trade-offs
- Raw SQL in a migration is not visible in `schema.prisma`, so a reader of the
  schema alone will not see the constraint. Mitigated by a comment on `kind`
  pointing at it, and by a test that asserts the database rejects both
  forbidden combinations — the constraint is verified behaviour, not a
  migration comment.
- `PracticeSet` now serves two concepts. The name stops being perfectly
  descriptive, and renaming it is not worth a migration touching every M2 file.

### Follow-up required
- [ ] Migration: `PracticeSetKind` enum, `kind` column defaulting to
      `PRACTICE`, `extractionId` made nullable, CHECK constraint.
- [ ] Integration test asserting the database itself rejects
      `PRACTICE`-with-null and `CHECKPOINT`-with-an-extraction.
- [ ] `toPracticeSetDTO` must expose `kind` — the client renders a checkpoint
      differently, and `extractionId` becomes nullable in the DTO too.
- [ ] Re-check the deletion bijection test after the column changes.

## Revisit when

A third kind appears that is neither practice nor a checkpoint, or a checkpoint
ever needs to reference the specific extractions it drew from — at which point
the join table this ADR deliberately avoided becomes the right answer.
