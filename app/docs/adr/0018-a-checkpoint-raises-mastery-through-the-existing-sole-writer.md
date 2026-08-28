# ADR-0018: A checkpoint may raise mastery, through the existing sole writer

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m2-5-checkpoints.md — this resolves its one **blocking**
  open question.

## Context

The M2.5 spec left one question blocking, because it decides a structural
property rather than a behaviour: **may acing a checkpoint raise
`SkillMastery.level`?**

Both answers looked expensive. Refusing means a student who demonstrably
improved gets no credit, and a checkpoint becomes a thing that can only ever
confirm what practice already decided. Allowing it appeared to mean a second
code path writing mastery — and `lib/mastery/apply.ts` is currently the sole
writer, with `tests/unit/lib/mastery/sole-writer-guard.test.ts` enforcing that.

ADR-0010 is binding either way: `level` is a ratchet, `MASTERY_LADDER`'s top
rung requires a correct streak spanning two different practice sets, an
`UNSCORED` attempt is evidence in neither direction, and a correct answer given
after the worked solution was revealed earns nothing.

## Decision

**We will let a checkpoint raise mastery, and add no new writer, because
ADR-0017 makes them the same path.**

A checkpoint is a `PracticeSet` with `kind = CHECKPOINT`. Its problems are
`PracticeProblem` rows. Answers to them are submitted to the existing
`POST /api/practice-problems/[problemId]/attempts` route, graded by the existing
two-stage path, and written by the existing `applyMastery` inside the existing
transaction.

So the question dissolves. `lib/mastery/apply.ts` remains the sole writer,
**unchanged**, and its guard test keeps passing without amendment. There is no
second path to reconcile because there is no second path.

Three consequences fall out, and each is the behaviour we want rather than one
we tolerate:

1. **The two-set rule works in a checkpoint's favour, correctly.** `SECURE`
   requires a streak spanning two different sets. A checkpoint is by
   construction a different set, drawn from skills practised elsewhere and
   often days earlier. A correct checkpoint answer is therefore *stronger*
   evidence than another correct answer in the set where the streak began —
   which is exactly what the two-set rule was written to capture. It was
   designed for this case before this case existed.

2. **A missed checkpoint resets the streak and never lowers the level.**
   `consecutiveCorrect` goes to zero, as it does for any incorrect answer;
   `level` cannot fall, because the ratchet's guarded write only ever matches
   rows strictly below the candidate. The child sees a point-in-time result and
   no number that dropped (M2.5 AC 13, AC 14). The server learns that the skill
   needs revisiting. Both halves of the spec's hardest constraint hold with no
   special-casing.

3. **The server-side signal M2.5 AC 15 asks for already exists.** An `Attempt`
   row carries its result and its `practiceSetId`; that set carries its `kind`.
   "How did this student do on checkpoints for skill X" is a query, not a new
   model. M7's scheduler reads it when M7 is built; `retentionEstimate` stays an
   M7 column that M2.5 does not write.

`MASTERY_MIN_ATTEMPTS_FOR_REPORT` (ADR-0010's revision note) applies unchanged:
a checkpoint answer decided by the model increments `modelGradedCount` like any
other, so the evidence floor keeps counting the same thing.

## Alternatives considered

### Checkpoints never write mastery
- **Pros:** Absolute separation; a checkpoint could never inflate a level.
- **Cons:** A student who proves retention on old material gets nothing for it,
  and the milestone's own user story — "I want to check whether I still remember
  something" — becomes a read-only curiosity. It also means a *second* attempts
  path that deliberately skips `applyMastery`, which is the extra code path this
  option claims to avoid.
- **Rejected because:** it costs a code path to buy less correctness.

### A separate `applyCheckpointMastery` with its own rules
- **Pros:** Checkpoint-specific weighting becomes possible — counting a
  checkpoint answer for more than a practice answer, say.
- **Cons:** Two writers on a ratchet, racing on the same rows, with the
  sole-writer guard deleted to permit it. The weighting it buys is speculative.
- **Rejected because:** the guard exists for a reason and no evidence yet says
  checkpoint answers should weigh differently. If that evidence appears, weight
  it inside the one writer.

### Let a failed checkpoint lower the level
- **Pros:** The mastery display would tell the truth about decay.
- **Cons:** Directly violates ADR-0010, M2 AC 19/20 and M2.5 AC 13 — the
  product's firmest constraint, that a child never watches a score fall.
- **Rejected because:** the honest signal belongs in the server-only layer,
  which is precisely where `retentionEstimate` was already put.

## Consequences

### Positive
- The blocking question is answered without a schema change, a new writer, or
  an amended guard test.
- Every existing mastery test keeps its meaning; the concurrency properties
  reviewed on 2026-08-27 carry over untouched.
- `SECURE` becomes harder to reach by rote and easier to reach by genuinely
  retaining something, which is the direction the ladder was aiming.

### Negative / accepted trade-offs
- A checkpoint answer and a practice answer count identically. That is probably
  slightly wrong — retention across days should count for more — and is
  deliberately left wrong until there is data to weight it with.
- Because checkpoints reach `SECURE` more readily via the two-set rule, the
  ratchet's existing accepted trade-off gets slightly sharper: a child who
  reached `SECURE` through a checkpoint in March and has since forgotten it
  still shows `SECURE`. Unchanged in kind, marginally more reachable.

### Follow-up required
- [ ] The attempts route must reject a second attempt when the set is
      `CHECKPOINT` (M2.5 AC 11) — a `requireFlow` branch beside the existing
      `MAX_ATTEMPTS_PER_PROBLEM` check.
- [ ] The reveal route must 409 for a `CHECKPOINT` set.
- [ ] A test asserting `applyMastery` is still called from exactly one place
      after M2.5 lands — extend `sole-writer-guard.test.ts` rather than
      replacing it.

## Revisit when

Real checkpoint data exists and shows that a retained-across-days correct answer
predicts durable mastery better than an in-session one — at which point weight
it inside `applyMastery`, never beside it.
