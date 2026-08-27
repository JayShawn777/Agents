# Spec: Checkpoints — quizzes that show a student they are getting better

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** Claude (inline; not the product-spec agent — see "Process note")
- **Milestone:** **M2.5**, between M2 and M3
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) how a
  checkpoint set is modelled against `PracticeSet` without weakening M2 AC 3's
  extraction invariant, and (b) what a checkpoint result is allowed to change,
  given ADR-0010's monotonic ratchet. Depends on ADR-0009 (taxonomy),
  ADR-0010 (mastery ratchet), ADR-0011 (two-stage grading).

## Process note — why this is M2.5 and not part of M3

The owner asked for quizzes and tests and left the placement to whatever produces
the cleanest result. Three placements were considered.

**Not M3.** M3's spec binds a chat session to exactly one of the student's own
problems and lists "no memory across sessions" and "cross-session adaptation is
M7" among its non-goals. A checkpoint is cross-session by definition — it asks
what a student retained from work done days ago. Putting it in M3 means gutting
the non-goals that give M3 its shape, and bolting a multi-session data model onto
a milestone that explicitly disclaims one. That is the worst available outcome
for the code.

**Not folded into M7.** M7 already owns the closest machinery — spaced
repetition, `nextReviewAt`, the parent report — and the temptation is to say a
checkpoint is just a review session. But M7 is last, and the owner was explicit
that this is core rather than a finishing touch: a student should be able to see
they are improving well before milestone seven. M7 is also already the largest
and vaguest milestone in the plan, and the M0–M2 retro's lesson #10 records
over-large slices as this project's top delivery failure. Adding to it makes the
known problem worse.

**Its own milestone, immediately after the M2 review.** A checkpoint is an
extension of M2's machinery — the same taxonomy, the same generation call, the
same two-stage grading, the same answer-key separation, the same mastery rows.
It shares almost nothing with chat. Placing it here also means the one schema
change it needs — `PracticeSet` learning to have a source other than a single
extraction — lands while M2 is still unshipped and unreviewed, rather than after
four more milestones have built on that model. That migration is cheap now and
expensive later.

Numbering it 2.5 rather than renumbering M3–M7 keeps roughly fifteen existing
references in ADRs 0012–0015 and `docs/plans/m2-m7-implementation.md` correct.

## Problem

A student uploads a worksheet, gets six practice problems, works through them,
and then the thread ends. Nothing ever comes back to ask whether the thing they
practised on Monday is still there on Friday. The app can tell a parent how many
problems a child answered, and it can tell them a skill reached `SECURE` at some
point in the past, but it cannot answer the question both the parent and the
child actually have — *am I getting better?*

Worse, the app is currently structured so that it cannot find out it is wrong.
`SkillMastery.level` is a ratchet that never falls (ADR-0010, deliberately). A
child who reached `SECURE` in March and has forgotten all of it still reads as
`SECURE`, and there is no mechanism anywhere in M0–M2 that would ever discover
the gap. The one honest signal — put the skill in front of the child again and
see what happens — does not exist.

## Goal

A student can take a short, mixed checkpoint drawn from the skills they have
actually worked on across all of their uploads, see how they did, and have the
result quietly steer what the app gives them next — without ever being shown a
number that went down.

## Non-goals

Named because a reader will reasonably assume several of these are included.

- **Not a graded exam, and not hard for its own sake.** The owner was explicit:
  this is not about difficulty. A checkpoint is short, finishable, and pitched at
  the level the student has been working at — the same `SKILL_GRADE_BAND`
  windowing M2 already uses. It is a check, not a gate.
- **No score that can fall, anywhere a child can see it.** M2 AC 19 and AC 20 are
  binding here and are the hardest constraint in the milestone. A single
  checkpoint result ("6 of 8") is a point-in-time outcome and is fine. A
  percentage that was 80 last month and is 60 now is forbidden, on every child
  surface, in every framing.
- **No change to the mastery ratchet.** A checkpoint never lowers
  `SkillMastery.level`. ADR-0010 stands. What a poor checkpoint changes is
  *server-side* and is described in AC 14–16.
- **No diagnostic placement test.** M7's non-goals already forbid this and it
  stays forbidden. A checkpoint only ever covers skills the student has
  demonstrably worked on. It never probes territory they have not seen.
- **No scheduling engine.** *When* a checkpoint should happen is M7's spaced
  repetition. M2.5 ships the checkpoint itself plus one simple readiness signal
  (AC 4), not an interval table.
- **No timer, no time limit, no countdown.** Elapsed time is recorded as M2
  already records it; it is never displayed to a child as pressure.
- **No new question types.** Checkpoints reuse M2's `AnswerFormat` set exactly.
- **No essay or long-form writing assessment.** A `SHORT_TEXT` answer is graded
  by the M2 two-stage path and nothing longer is introduced here.
- **No comparison to other students**, no percentiles, no rankings, no streaks.
- **No new AI surface.** Checkpoint problems are generated by the same call shape
  as M2 practice generation, against the same closed skill slate.
- **No parent-assigned checkpoints.** An adult cannot set homework. M7's parent
  report may later *show* checkpoint outcomes; assigning them is not this and may
  never be.
- **No certificate, badge, reward, points or unlock.**

## User stories

- As a student, I want to check whether I still remember something I learned a
  while ago, so that I find out before a real school test does.
- As a student, I want the check to be short and finishable, so that starting one
  is not a commitment I regret.
- As a student, I want a skill I once got good at to stay green even if I get
  rusty, so that coming back after a break is not a punishment.
- As a student, I want the app to give me more of what I got wrong afterwards, so
  that the checkpoint was worth taking.
- As a parent, I want to see that my child was checked on old material and not
  only on today's worksheet, so that I can believe the progress I am being shown.
- As a parent, I want to know when the app's picture of my child is out of date,
  so that I am not reassured by a number nobody has tested in two months.

## Acceptance criteria

**Preconditions for every criterion.** All behaviour applies to student profiles
whose status is `ACTIVE` (M0 AC 36) on an account with valid parental consent
(M0). Every route follows ADR-0006 (route handlers, not server actions) and
returns the typed error shape.

### Eligibility and composition

1. **Given** a student profile with fewer than the configured minimum number of
   distinct practised skills, **when** a checkpoint is requested, **then** it is
   refused with a typed reason, no AI call is made, and the surface explains that
   there is not enough work to check yet.
2. **Given** a student profile with enough practised skills, **when** a checkpoint
   is composed, **then** every skill it draws on has at least one recorded
   attempt by that student, and no skill the student has never practised appears.
3. **Given** a composed checkpoint, **when** its skills are inspected, **then**
   they span more than one skill code, are ordered oldest-practised first, and
   every one sits within `SKILL_GRADE_BAND` of the student's grade level.
4. **Given** a student profile, **when** its checkpoint readiness is queried,
   **then** the response says whether a checkpoint is available and, if not, why
   — and this is the only scheduling signal M2.5 ships.
5. **Given** a checkpoint is requested twice concurrently for one student profile,
   **when** both requests are handled, **then** exactly one checkpoint set is
   created and the second is refused or returns the first.
6. **Given** the configured hourly cap on generation for a student profile has
   been reached (M2 AC 26 counts the same rows), **when** a checkpoint is
   requested, **then** it is refused before any AI call.

### Generation and grading — reusing M2

7. **Given** a checkpoint generation request, **when** the outbound request to
   Anthropic is captured, **then** it carries only the fields M2 AC 6 and
   `lib/ai/outbound.ts` already permit — no display name, avatar id, account
   email, user id or student profile id.
8. **Given** a checkpoint generation response, **when** any returned problem
   carries a `skillCode` outside the closed slate supplied in the request,
   **then** the whole set fails cleanly with a typed failure code and zero
   partial writes, exactly as M2 AC 5 requires of practice generation.
9. **Given** a completed checkpoint set, **when** its problems are fetched by the
   client, **then** no payload at any point contains a canonical answer, an
   accepted alternate form, or a worked solution for an unanswered problem — the
   M2 answer-key separation is unchanged and its existing test must still pass.
10. **Given** a submitted checkpoint answer, **when** it is graded, **then** it
    goes through the same two-stage path as practice (ADR-0011): deterministic
    normalisation first, model adjudication only on a stage-one miss.
11. **Given** a checkpoint problem answered incorrectly, **when** the response is
    returned, **then** the student is **not** offered the reveal-after-N-attempts
    path M2 provides for practice — a checkpoint problem is answered once and the
    set moves on. *(This is the one deliberate behavioural difference from
    practice, and the reason it is not simply "another practice set".)*

### What the student sees

12. **Given** a finished checkpoint, **when** its result is rendered, **then** the
    student sees how many they got right out of how many were asked, and which
    skills came up, in the descriptor vocabulary of M2 AC 9 — never a raw code.
13. **Given** a finished checkpoint, **when** every child-facing payload for it is
    inspected across the whole milestone, **then** none of them contains a value
    that is lower than a previously rendered value for the same skill or student:
    no percentage-over-time, no delta, no arrow, no "down from". *(Directly
    testable, and the criterion most likely to be violated by a well-meaning UI.)*
14. **Given** a checkpoint on which a skill was answered incorrectly, **when** the
    student's mastery row for that skill is read afterwards, **then**
    `SkillMastery.level` is greater than or equal to its value before the
    checkpoint. It never decreases.

### What the server learns

15. **Given** a graded checkpoint, **when** the server-side record is inspected,
    **then** the per-skill outcome is persisted in a form M7's scheduler can read,
    and that record is never included in any client payload on any surface.
16. **Given** a skill answered incorrectly on a checkpoint, **when** the student's
    next practice is composed, **then** that skill is preferentially included.
    *(This is what makes the checkpoint worth taking rather than merely
    informative.)*
17. **Given** a checkpoint, **when** the account owner's view is rendered, **then**
    it can show that a check happened, when, and which skills it covered, in
    plain language and without a falling number.

### Data lifecycle

18. **Given** a checkpoint set drawn from skills sourced across several
    extractions, **when** one of those extractions is deleted, **then** the
    checkpoint's own rows behave per an explicitly stated rule — not per an
    accidental cascade — and that rule is written into the deletion story before
    implementation.
19. **Given** a student profile deletion (M0), **when** it completes, **then** no
    checkpoint row, problem, answer key or result survives for that profile, and
    the existing deletion bijection test covers every new model.
20. **Given** every new model this milestone adds, **when** `RETENTION_POLICY` is
    read, **then** each has a row with a window, and the existing bijection test
    that every windowed model is enumerated still passes.
21. **Given** a checkpoint problem, **when** its text is inspected, **then** it is
    newly generated content and does not reproduce the child's uploaded work
    verbatim. *(Checkpoints outlive the uploads they derive from; they must not
    become a back door that retains a photograph's content past its window.)*

### Subjects

22. **Given** a student who has practised reading, science or social-studies
    skills, **when** a checkpoint is composed, **then** those skills are eligible
    on the same terms as math. *(The 2026-08-27 coverage fix must not be
    re-narrowed here — see ADR-0009's revision note.)*

## Out of scope for this milestone

- The spaced-repetition interval table and `nextReviewAt` scheduling (M7).
- The parent report proper (M7); M2.5 exposes the data, not the report.
- Checkpoints that mix in a skill the student has never practised.
- Any voice, whiteboard or narrated presentation of a checkpoint (M4–M6).
- Adaptive difficulty *within* a checkpoint — item order and level are fixed at
  composition time.

## Open questions

- [ ] **How many problems, and drawn from how many skills?** M2's
      `PRACTICE_SET_SIZE` is 6. A checkpoint spanning several skills probably
      wants 8–10, but this is an assumption until a real run exists — **non-blocking**,
      goes in `lib/config.ts` with an `ASSUMPTION` comment like its neighbours.
- [ ] **What is the minimum body of work before a checkpoint is offered?**
      Proposed: three distinct skills with at least one attempt each — **non-blocking**.
- [ ] **Does a checkpoint result feed `consecutiveCorrect`, and therefore the
      ratchet upward?** A student who aces a checkpoint arguably deserves to
      advance. Letting it count means one code path raises mastery from two
      sources; refusing means a checkpoint can only ever confirm. **Blocking** —
      the architect must decide this in the ADR, because it determines whether
      `lib/mastery/apply.ts` stays the sole writer (it currently has a
      sole-writer guard test).
- [ ] **What does the account owner see when a checkpoint goes badly?** "Needs
      review" framing is safe; anything resembling a fall is forbidden by AC 13
      even on an adult surface, because adult surfaces get read aloud to
      children. **Non-blocking**, but decide before the frontend track starts.

## Data touched

**Reads:** `SkillMastery` (skills practised, attempt counts, last practised),
`PracticeProblem` and its attempts (to establish which skills are eligible),
`StudentProfile.gradeLevel` and subjects. No uploaded image or PDF is read.

**Writes:** a checkpoint set and its problems, answer keys held server-side under
the M2 separation, per-problem attempts, and a per-skill server-only outcome
record. Mastery rows are updated only in the upward direction permitted by
ADR-0010.

**Transmits:** one outbound Anthropic generation call and, on a stage-one grading
miss, one adjudication call — both carrying the `lib/ai/outbound.ts` learner
facts only, with no direct identifiers. No new vendor, so no new name in the
§312.4 direct notice and no new row in the vendor capability assessment.

**Retention:** every new model gets a `RETENTION_POLICY` row and a deletion story
before implementation (AC 18–20). Because a checkpoint derives from schoolwork a
child uploaded, its rows are student personal data under COPPA and are treated as
such — not as ordinary application records.
