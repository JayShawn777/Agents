# ADR-0010: Mastery is a monotonic ratchet over per-skill counters, and review scheduling is a separate axis

## Revision 2026-08-27 — §5's evidence floor did not exist

§5 below describes `MASTERY_MIN_ATTEMPTS_FOR_REPORT` in the present tense —
"`MASTERY_MIN_ATTEMPTS_FOR_REPORT` uses it" — as a control that keeps a skill
out of M7's parent report until at least one attempt was graded by the
deterministic normaliser rather than the model.

**No such constant existed anywhere in the codebase.** It appeared only in this
ADR and in `docs/plans/m2-m7-implementation.md` §10, which gives its value as 4.
Found during M2's security review on 2026-08-27, and it is the retro's lesson 11
in a new costume: a control asserted in a document, referenced by another
document, and implemented nowhere — with nothing failing, because its consumer
(the parent report) is not built yet.

It now exists in `lib/config.ts` with the plan's value, ahead of its consumer,
and says so in its own docstring. **Whoever builds M7 must wire it in.** It is
not decoration: the same review found that a student's submitted answer reaches
the grading model as raw prompt text, and this ADR's own ratchet means an
inflated level can never be corrected downward. See `lib/ai/untrusted.ts`.

§5 is left as originally written, below, for the record.


- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m2-practice-and-mastery.md, docs/specs/m7-adaptive-loop.md

## Context

M2 AC 18 fixes the fields: exactly one record per (student profile, skill code)
holding **attempts count, correct count, consecutive-correct count,
last-practised timestamp, and a level from the ordered set** `NOT_STARTED` →
`BEGINNING` → `DEVELOPING` → `SECURE`.

AC 19 fixes the behaviour, unusually explicitly: a skill at `SECURE` followed by
**five wrong answers is still `SECURE`**, stored and displayed. AC 20 forbids any
student-facing payload from containing an accuracy percentage, a 0–100 score, a
streak counter, **or any value lower than the same value was on a previous render
for the same skill**.

`docs/research/tutoring-product-patterns.md` §9 is the reason. IXL's SmartScore
is documented as simultaneously its best-loved and most-hated feature; the
"Challenge Zone" penalty asymmetry (+1–2 for correct, −3–8 for incorrect near the
top of the scale) is the single most-cited stressor in review aggregation, with
parents reporting children crying. §10 lists "punitive, decreasing mastery scores
shown directly to a child" as an explicit **reject**.

M7 then arrives and asks for the opposite thing. AC 9 wants `nextReviewAt` on the
mastery record. AC 10 wants it to **reset to the shortest interval on a failed
review**. AC 12 states the collision and resolves it in one sentence: a `SECURE`
skill that is overdue is *still displayed* as `SECURE`, "never as lost, expired,
downgraded, or as a number that has fallen." AC 13 requires any server-side
retention or decay estimate to be absent from every student-facing payload. M2's
own open questions call this out and mark it **blocking for M7**.

Two more constraints bear on the shape:

- **M7 AC 14** requires a completed review set to update each reviewed skill's
  record **exactly once**, and **AC 16** requires every count in the parent report
  to equal the count of the underlying rows with no attempt counted twice across
  a practice set and a review of the same skill.
- **M2 AC 25** says deleting the extraction a practice set came from removes "its
  practice sets, practice problems, attempts **and mastery records**". Read
  literally that would wipe a skill's whole history because one worksheet was
  deleted, which cannot be what is meant — mastery is per (profile, skill) and
  accumulates across many worksheets. This ADR resolves it, in the manner
  ADR-0006 resolved M0 AC 18 against AC 20, rather than leaving two engineers to
  resolve it differently.

Doing nothing is not available: the mastery record is the join point between M2,
M7's schedule, M7's report and M3's cached prompt context, and it lands in the
first M2 migration.

## Decision

We will store **raw counters as the state and the level as a monotonically
increasing high-water mark**, and we will keep **review scheduling on the same
row but on a strictly separate axis that never touches the level**.

### 1. The row

```prisma
model SkillMastery {
  studentProfileId   String
  skillCode          String        // ADR-0009: a bundled-taxonomy code, no FK

  attemptCount       Int          @default(0)   // AC 18
  correctCount       Int          @default(0)   // AC 18
  consecutiveCorrect Int          @default(0)   // AC 18 — resets to 0 on a miss
  modelGradedCount   Int          @default(0)   // provenance; see §5
  level              MasteryLevel @default(NOT_STARTED)   // THE RATCHET
  levelReachedAt     DateTime?
  lastPracticedAt    DateTime?                  // AC 18

  // M7 only, added in the M7 migration, never read by M2:
  reviewIntervalIndex Int      @default(0)
  reviewCount         Int      @default(0)
  nextReviewAt        DateTime?
  retentionEstimate   Float?                    // M7 AC 13 — server-only, always

  @@unique([studentProfileId, skillCode])
}
```

`consecutiveCorrect` **does** reset to zero on a wrong answer. That is not a
violation of AC 20, because AC 20 governs *rendered payloads* and
`consecutiveCorrect` is never rendered. It is the input to the ratchet, not an
output.

### 2. The ratchet

`level` is a pure function of `consecutiveCorrect`, clamped upward:

```
levelFor(consecutiveCorrect) = the highest entry in MASTERY_LADDER
                               whose threshold is <= consecutiveCorrect
newLevel = max(storedLevel, levelFor(consecutiveCorrect))
```

`MASTERY_LADDER` lives in `lib/config.ts` as an ordered table
(`BEGINNING` at 1, `DEVELOPING` at 3, `SECURE` at 5 — assumptions), so the ladder
is one array and not five literals.

`max()` is the whole of AC 19. Five wrong answers set `consecutiveCorrect` to 0,
which computes `levelFor` as `NOT_STARTED`, and `max(SECURE, NOT_STARTED)` is
`SECURE`. The stored value does not move and the displayed value cannot.

**Concurrency.** Prisma cannot express `GREATEST` on an enum column, and two
attempts submitted in quick succession must not clobber each other. The update is
two statements inside one transaction, neither of which is a read-modify-write:

```ts
// 1. atomic counters
await tx.skillMastery.update({ where: { studentProfileId_skillCode },
  data: { attemptCount: { increment: 1 },
          correctCount: { increment: correct ? 1 : 0 },
          consecutiveCorrect: correct ? { increment: 1 } : { set: 0 },
          modelGradedCount: { increment: gradedBy === 'MODEL' ? 1 : 0 },
          lastPracticedAt: now } });

// 2. the ratchet, expressed as a guarded write rather than a comparison
await tx.skillMastery.updateMany({
  where: { studentProfileId_skillCode, level: { in: LEVELS_BELOW[newLevel] } },
  data:  { level: newLevel, levelReachedAt: now } });
```

`LEVELS_BELOW` is derived from `MASTERY_LEVEL_ORDER` in `lib/domain/enums.ts`.
A concurrent write that already raised the level makes statement 2 match zero
rows, which is a no-op — the same shape as ADR-0007's `verified_at IS NULL`
stamp, and for the same reason.

### 3. Exactly once (M7 AC 14, AC 16)

`Attempt.appliedToMasteryAt DateTime?`. The mastery update runs only for attempts
where it is null, and sets it in the same transaction with a guarded
`updateMany({ where: { id, appliedToMasteryAt: null } })`. If that matches zero
rows, the transaction is abandoned and no counter moves.

This makes "no attempt counted twice across a practice set and a review of the
same skill" (M7 AC 16) a property of one column rather than of a join the report
has to get right, and it makes M7's review-set completion idempotent without a
second mechanism.

**One deliberate exception:** an attempt submitted **after** the worked answer has
been revealed (M2 AC 12) is stamped `appliedToMasteryAt` immediately with **no
counter change**. Typing back an answer you were just shown is not evidence, and
crediting it would corrupt the one number the parent report rests on.

### 4. Review scheduling is a different axis, and it may not touch `level`

M7's schedule writes `reviewIntervalIndex`, `nextReviewAt`, `reviewCount` and
`retentionEstimate`. It **never** writes `level`. A failed review resets
`reviewIntervalIndex` to 0 and `consecutiveCorrect` to 0; `level` is still
governed by `max()` and therefore still cannot fall.

The interval table (`REVIEW_INTERVALS_DAYS`, assumed `[1, 3, 7, 16, 35]`) is a
deterministic array in `lib/config.ts`. A fixture of outcomes produces an exact
sequence of dates, which is what makes M7 AC 10 testable.

`retentionEstimate` and `nextReviewAt` are **server-only columns**. Neither
appears in `SkillMasteryDTO`, and a test asserts the DTO's key set exactly. That
is M7 AC 13, enforced at the type boundary rather than by remembering.

M7 AC 12 then falls out with no special case: an overdue `SECURE` skill renders
`SECURE`, and the *only* difference the student sees is that it appears in the
review set. "Ready to practise again" is a queue membership, not a level.

### 5. Provenance: `modelGradedCount`

`modelGradedCount` records how many of `correctCount` were decided by the model
adjudicator rather than the deterministic normaliser (ADR-0011). It is
**server-only** and never in a student DTO.

It exists because M7's parent report is a durable narrative judgement of a child
built on three layers of unmeasured inference, and this column is the only way
the report can be honest about how much of a level rests on a machine's opinion.
`MASTERY_MIN_ATTEMPTS_FOR_REPORT` uses it: a skill is excluded from the parent
report's "getting better" list until it has enough attempts and at least one that
the deterministic path graded.

### 6. Resolving M2 AC 25

**`SkillMastery` is scoped to the student profile and is removed only when the
profile is removed.** Deleting an extraction cascades its practice sets, practice
problems and attempts; it does **not** delete or recompute mastery records.

The reason is that the alternative is worse in both directions. Deleting the
mastery record would destroy a skill's whole history because one worksheet was
deleted. Recomputing it from the surviving attempts would *lower* counters —
which the ratchet forbids for `level` and which would silently rewrite the parent
report's history.

The accepted consequence, stated plainly: **after an extraction is deleted, the
mastery counters describe attempts that no longer exist.** M7 AC 16's "each count
in the report equals the count of the underlying rows" is therefore satisfied for
counts the report derives from `Attempt` rows and is *not* satisfied for
`SkillMastery.attemptCount`. The report must derive its counts from `Attempt`,
and `SkillMastery` must be treated as a level and a schedule, not as a source of
report numbers. This is written into the plan's DTO rules.

Profile deletion, the parent's §312.6 request and account closure remove
everything, unchanged — `SkillMastery` cascades from `StudentProfile` like every
other M2 model.

## Alternatives considered

### A 0–100 score per skill, IXL's SmartScore
- **Pros:** Fine-grained, familiar to parents who have used IXL, gives an obvious
  progress bar, and encodes recency and difficulty in one number.
- **Cons:** It is the single documented anxiety driver in the category, and the
  mechanism that causes it — a number that falls after real effort — is exactly
  what AC 19 and AC 20 forbid in terms. Making it monotonic would make it
  meaningless (a score that only rises is a count wearing a percent sign).
- **Rejected because:** the research names it as a reject and the spec forbids it.

### Bayesian Knowledge Tracing or an IRT model
- **Pros:** The academically respectable answer. Produces a calibrated
  probability of mastery, handles guessing and slipping, and would give M7 a real
  retention estimate instead of an interval table.
- **Cons:** M7's non-goals forbid it in terms ("No psychometric model... no IRT,
  no Bayesian knowledge tracing"). It also needs item difficulty parameters we do
  not have and cannot estimate at our data volume, and its output is a
  probability that *falls*, which then has to be hidden from the student anyway —
  so we would carry the complexity and still need the ratchet on top. The
  research found no primary technical source for how IXL or Khan actually do this,
  so we would be inventing under a deadline.
- **Rejected because:** forbidden by the spec, unfittable at our data volume, and
  it does not remove the need for the display-side decision it is meant to
  replace.

### Store only the counters and derive `level` at read time
- **Pros:** One less column and no ratchet to maintain. Nothing can drift,
  because there is nothing to drift from.
- **Cons:** A derived level is a function of `consecutiveCorrect`, which falls —
  so the derived level falls, and AC 19 fails on the first render after a bad day.
  Deriving `max` over history would mean scanning every attempt on every read.
  And `levelReachedAt` — the thing that makes "you got there in March" possible —
  has nowhere to live.
- **Rejected because:** AC 19 requires the *stored* level to persist, and the
  spec says so in those words.

### An append-only `MasteryEvent` log, with the record projected from it
- **Pros:** Fully auditable; recomputable after a bug; the deletion question in
  §6 becomes answerable by replay; matches the append-only posture ADR-0007 took
  for consent.
- **Cons:** Every read becomes a fold, or we cache the fold and are back where we
  started with a second consistency problem. It is a materially larger surface
  for the one case (consent) where the audit trail is legally load-bearing —
  which mastery is not.
- **Rejected because:** the `Attempt` table already *is* the append-only log. It
  holds every graded submission with a timestamp, so mastery is recomputable from
  it if we ever need to. A second log of the same events is duplication.

### Let mastery decay with time, and hide the decay from the student
- **Pros:** More honest about forgetting, and it is what spaced repetition
  actually models. The parent could be told "this was secure in March and is
  probably rusty."
- **Cons:** Two divergent views of the same fact — a green badge for the child
  and "probably rusty" for the parent — is either the humane answer or a
  credibility problem, and M7's open questions say plainly that it is undecided.
  It also puts a decaying number in the database that one careless DTO leaks.
- **Rejected for now because:** M2 AC 19 is binding today, and `retentionEstimate`
  is already reserved as a nullable server-only column so this can be added in M7
  without a schema change. The decision belongs to the owner, not to us — see
  Follow-up.

## Consequences

### Positive
- AC 19 is one `max()`, in one function, in one module. A reviewer can audit
  "can a level ever fall?" by reading `lib/mastery/apply.ts` and grepping for any
  other write to `skillMastery.level`.
- AC 20's hardest clause — "no value lower than the same value was on a previous
  render" — is satisfied structurally: the only numbers in `SkillMasteryDTO` are
  `attemptCount` (monotonic) and a level that cannot fall.
- M7's collision with M2 is resolved before either is built, and resolved on the
  schema rather than in the UI, so no later milestone can accidentally re-open it.
- Exactly-once mastery application is one nullable timestamp, which also gives
  M7 AC 16 for free and makes review-set completion idempotent.
- Every field M7 needs exists or has a stated place, so no corrective migration
  is required between M2 and M7. This is the single clearest payoff of designing
  the six schemas in one pass.

### Negative / accepted trade-offs
- **A ratchet is a lie with a good reason.** A child who reached `SECURE` in
  March and has forgotten everything still shows `SECURE`. We are choosing the
  child's willingness to keep practising over the number's accuracy, deliberately,
  and the review queue is what stops that being a lie with no consequence. It
  should be said out loud in any parent-facing copy that renders a level.
- **`SkillMastery.attemptCount` can outlive the attempts it counted** (§6). The
  report must not use it. This is a rule a future engineer can break silently, so
  it is a named DTO rule and a test.
- **`consecutiveCorrect` is a fragile signal at our set size.** Six problems per
  set with `SECURE` at 5 consecutive means a single set can carry a skill from
  nothing to `SECURE`. That is almost certainly too fast, and the ladder
  thresholds should be re-set from the first real fixture run rather than shipped
  at the assumed values.
- **`modelGradedCount` only helps if something reads it.** A column that records
  provenance and is never surfaced is worse than nothing, because it creates the
  appearance of rigour. The plan makes the parent report's evidence floor depend
  on it, and that dependency is the thing to check in review.
- Four discrete levels is coarse. A student grinding a hard skill sees no
  movement for a long time, which is its own discouragement — the opposite
  failure from SmartScore's. `problemsPracticed` in the DTO is the mitigation and
  it is a weak one.

### Follow-up required
- [ ] **Owner decision, blocking for M7's report design:** does the *parent* see
      a decay-aware view ("secure in March, probably rusty") while the child sees
      a stable level? M7's own open questions call this the central design
      question of the milestone. `retentionEstimate` exists so the answer costs no
      migration either way.
- [ ] Re-set `MASTERY_LADDER` thresholds from the first fixture run. The assumed
      1/3/5 is a guess and 5-of-6 is probably too generous.
- [ ] A Vitest test asserting `SkillMasteryDTO`'s key set **exactly**, so
      `correctCount`, `consecutiveCorrect`, `modelGradedCount`,
      `reviewIntervalIndex`, `nextReviewAt` and `retentionEstimate` cannot be
      added to a payload by a future convenience (M2 AC 20, M7 AC 13).
- [ ] A reviewer grep for any `skillMastery.update` outside `lib/mastery/apply.ts`
      — the same control ADR-0007 uses for `parentalConsent.update`.
- [ ] Decide whether `Attempt` rows expire sooner than mastery. M2's spec calls
      this "a reasonable position" and says it would be a new row in M0's
      retention table. If they do, §6's warning gets sharper.

## Revision note — 2026-08-27, the owner's two-set correction to §2

Flagged by the owner during M2 implementation, and confirmed by the
"Negative / accepted trade-offs" section this ADR already wrote: *"Six
problems per set with SECURE at 5 consecutive means a single set can carry a
skill from nothing to SECURE. That is almost certainly too fast."* This was
correct, and because `level` is a ratchet, the mistake would have been
permanent per skill the first time it happened.

**The fix:** the ratchet's TOP rung (`SECURE`) may not be reached until the
evidence — the consecutive-correct streak — has touched at least two distinct
`PracticeSet`s. Lower rungs (`BEGINNING`, `DEVELOPING`) are unaffected, and
no counter's accumulation rule changes: `attemptCount`, `correctCount` and
`consecutiveCorrect` still update exactly as §1/§2 describe.

**Implementation, one column beyond §1's original field list:**
`SkillMastery.streakStartPracticeSetId String?` — the `PracticeSet` the
CURRENT consecutive-correct streak began in, reset to `null` alongside
`consecutiveCorrect` on any wrong answer. A given attempt's evidence "spans
two sets" iff `streakStartPracticeSetId` is set AND differs from the
`PracticeSet` that attempt belongs to — true the moment a streak that started
in one set picks up a correct answer in a different one, and never before.
`MASTERY_LADDER` (`lib/config.ts`) gained a `requiresMultiplePracticeSets`
flag, set only on the `SECURE` entry; `lib/mastery/apply.ts`'s `levelFor`
skips any rung whose flag is set unless the streak has spanned two sets.

Like `consecutiveCorrect` itself, `streakStartPracticeSetId` is NEVER
rendered — it is an input to the ratchet, not an output, and is absent from
`SkillMasteryDTO` (asserted by the same exact-key-set test §2's follow-up
already asked for).

Tested at the boundary directly: `tests/unit/lib/mastery/apply.test.ts`
(the pure `levelFor` table, including "five consecutive correct within ONE
set does NOT reach SECURE") and
`tests/integration/mastery-two-set-ratchet.test.ts` (the same boundary
through the real `applyMastery` transaction against Postgres). Both were
run against the code with this gate removed first and confirmed to fail
before the fix was restored — a regression test that has never gone red is
not evidence.

**Concurrency caveat, stated rather than solved (see `lib/mastery/apply.ts`'s
own docstring):** `consecutiveCorrect` and `streakStartPracticeSetId` are
computed from a read earlier in the same transaction, not from an atomic
increment or a guarded write the way `level` itself is. Two attempts on the
SAME skill landing in overlapping transactions could in principle race on
these two fields. Accepted at the same severity as this codebase's existing
count-then-create rate-limiter races (`lib/uploads/rate-limit.ts`): a single
child submits one answer at a time, and the worst case is an undercounted
streak by one, never a level moving down.

## Revisit when

The owner answers the parent-facing decay question; or a measured fixture run
shows the ladder thresholds are wrong; or `Attempt` retention diverges from
mastery retention, at which point §6's "counters can outlive their attempts"
stops being an edge case and becomes normal; or a milestone genuinely needs a
level to fall, which would mean this ADR has stopped being true and should be
superseded rather than eroded.
