# Spec: Practice generation and mastery

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** product-spec agent
- **Milestone:** M2
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) the
  skill-taxonomy source and how it is stored, and (b) how a free-text student
  answer is judged equivalent to an answer key. Depends on ADR-0005 (structured
  output) and ADR-0006 (route handlers). Research:
  [tutoring-product-patterns.md](../research/tutoring-product-patterns.md),
  [anthropic-api.md](../research/anthropic-api.md).

## Problem

A student photographs their worksheet, the app reads the five problems off it
(M1), and then nothing happens. Five problems is not practice — it is the
homework they already had. A child who does not understand subtracting mixed
numbers needs six more of them, at the right level, not the same six they
already got wrong. And nobody — not the student, not the parent — can tell
whether anything was actually learned, because the app has no idea which of the
five the child could do and which they could not. Today the only way to find out
is for a parent to sit down and mark it by hand, which is precisely the labour
the product exists to remove.

## Goal

From a confirmed extraction, a student can get fresh problems of the same kind,
answer them, be told whether each answer is right with a hint rather than the
answer, and have their progress on each underlying skill recorded — encouragement
framed, never as a number that goes down.

## Non-goals

Named because a reader will assume several of these are here:

- **No chat.** The student cannot ask "why is that wrong?" after a graded
  attempt. That is M3, and it is the single most likely thing to leak in.
- **No explanation, worked solution animation, whiteboard or narration**
  (M4/M5/M6). AC 12 reveals a worked answer as *text* after the configured number
  of attempts, and that is the whole of the explanation surface in M2.
- **No spaced repetition, no review scheduling, no "practise this again on
  Thursday", no decay of mastery over time, no parent progress report.** All M7.
  M2 writes the mastery record; nothing schedules against it and no parent
  surface reads it.
- **No adaptive item selection.** M2 generates a set and the student works
  through it. There is no algorithm choosing the next question from the last
  answer, no IRT, no difficulty ladder that moves during a set. The research
  found no primary technical source for how IXL or Khan Academy actually do this;
  we are not inventing one under a deadline.
- **No new skill taxonomy.** We map to an existing published standards taxonomy
  (AC 7). Inventing a bespoke skill tree is explicitly forbidden by this spec.
- **No visible score that can go down.** No SmartScore, no percentage accuracy,
  no streak that breaks, no rank, no leaderboard, no comparison with siblings or
  with other students. IXL's Challenge Zone is the documented anxiety driver in
  the category and we are not reproducing it.
- **No answer-first behaviour.** The app never opens with the answer. A wrong
  first attempt does not reveal the correct answer (AC 11).
- **No essay, paragraph or open-ended writing assessment.** M2 grades short
  answers: a number, an expression, a short phrase, or a selection.
- **No handwriting or drawing input.** Answers are typed or selected.
- **No timed tests, no exam mode, no proctoring.**
- **No printing or exporting a practice set as a PDF or worksheet.**
- **No sharing generated problems between students or accounts**, and no reuse of
  one student's generated set for another student.
- **No offline practice.**
- **No practice from anything but a `CONFIRMED` extraction** — no topic picker,
  no "practise fractions" browse mode, no catalogue of pre-written problems.

## User stories

- As a student, I want more problems like the ones on my worksheet, so that I can
  actually get better at them instead of guessing at the same six twice.
- As a student, I want to type my answer and be told whether it is right, so that
  I do not have to wait for a parent to check it.
- As a student who got it wrong, I want a nudge rather than the answer, so that I
  still get to work it out myself.
- As a student who has got it wrong three times, I want to be shown how it is
  done, so that I am not stuck in a loop feeling stupid.
- As a student, I want to see that I am getting better at something, so that
  practice feels like it is going somewhere.
- As a student, I want a bad day not to erase what I already learned, so that I
  am not afraid to practise.
- As a parent, I want to know which specific skills my child is working on in
  words I recognise from school, so that I can tell whether this is the right
  level.
- As a parent, I want the problems to be new, not the same worksheet reprinted,
  so that my child is practising rather than memorising.
- As a student, I want to stop halfway and come back later, so that a practice
  set is not all-or-nothing.

## Acceptance criteria

**Preconditions for every criterion.** All M2 surfaces require a student profile
whose status is `ACTIVE` (M0 AC 36); a request against any other status returns
HTTP 403 with the typed error shape and performs no AI call. Practice is
generated only from an extraction in status `CONFIRMED` (M1 AC 30).

### Generating practice

1. **Given** an extraction in status `CONFIRMED` with five extracted problems,
   **when** the student requests practice, **then** a practice set is created
   containing the configured number of generated problems, each linked to the
   extracted problem it was modelled on, and each set is scoped to exactly one
   student profile.
2. **Given** a generated practice problem, **when** it is compared with its
   source extracted problem, **then** its text is not identical to the source
   text. *(Regenerating the worksheet verbatim is the failure mode this catches.)*
3. **Given** an extraction in any status other than `CONFIRMED`, **when**
   practice generation is requested for it, **then** the request is refused with
   the typed error shape and no practice set, problem or AI call is created.
4. **Given** an extracted problem the student corrected (M1 AC 28), **when**
   practice is generated from it, **then** the corrected text — not the original
   model output — is what appears in the generation request.
5. **Given** a generation response that fails zod schema validation
   (`parsed_output` is null), **when** it is processed, **then** the practice set
   status is `FAILED` with a retry option and **zero** practice problems are
   persisted. No partial set is written.
6. **Given** the model declines the request (`stop_reason` of `refusal`) or the
   generation exceeds the configured time limit, **when** it is processed,
   **then** the set status is `FAILED`, a plain user-facing message is shown, and
   no stack trace, model identifier, raw provider payload or internal error text
   reaches the browser.

### Skills

7. **Given** a generated practice problem, **when** it is persisted, **then** it
   carries exactly one primary skill code drawn from the bundled standards
   taxonomy, and that code resolves to a human-readable descriptor and a grade
   level. A generated problem whose skill code is not present in the taxonomy is
   rejected and not persisted.
8. **Given** a student profile with a grade level, **when** practice is
   generated, **then** every persisted problem's skill code has a taxonomy grade
   level within the configured band of that profile's grade level; a problem
   outside the band is rejected before persistence.
9. **Given** a practice set, **when** the student views it, **then** each problem
   displays the human-readable skill descriptor (for example "Add and subtract
   fractions with unlike denominators"), not the raw standards code.

### Answering and grading

10. **Given** a practice problem, **when** the student submits an answer, **then**
    an attempt row is persisted with the submitted answer, the grade result and a
    timestamp; and **when** the student answers the same problem again, **then** a
    second attempt row is created and the first is unchanged. Attempts are never
    overwritten.
11. **Given** a first incorrect attempt, **when** feedback is shown, **then** the
    student is told the answer is not right, is offered a retry, and the feedback
    text does not contain the canonical answer from the answer key.
12. **Given** the configured number of incorrect attempts on one problem has been
    reached, **when** the student submits again or asks for help, **then** a
    worked answer is revealed and the problem is marked as revealed rather than
    silently graded down.
13. **Given** an answer that is mathematically equivalent to the answer key in a
    different written form — `0.5` for `1/2`, `x = 3` for `3`, `2/4` for `1/2`
    where unsimplified forms are accepted for that skill — **when** it is graded,
    **then** it is graded correct. A fixture table of equivalent forms is the
    test.
14. **Given** an answer that cannot be confidently graded either way, **when** it
    is processed, **then** the result is `UNSCORED`, the student is not told they
    are wrong, and no mastery counter is decremented.
15. **Given** an empty or whitespace-only submission, **when** the student
    submits, **then** no attempt row is created and the student is prompted to
    enter an answer.
16. **Given** any submitted answer, **when** it reaches the API boundary, **then**
    it is validated against a zod schema with a maximum length, and an
    over-length or malformed body returns HTTP 400 with the typed error shape.
17. **Given** the answer key for a practice problem, **when** any payload
    delivered to the browser before that problem's attempt is submitted is
    inspected — HTML, JSON, or client bundle — **then** the answer key is not
    present in it.

### Mastery

18. **Given** graded attempts on a skill, **when** the mastery record is
    inspected, **then** exactly one record exists per (student profile, skill
    code) holding at least: attempts count, correct count, consecutive-correct
    count, last-practised timestamp, and a mastery level from the ordered set
    `NOT_STARTED` → `BEGINNING` → `DEVELOPING` → `SECURE`.
19. **Given** a skill at level `SECURE`, **when** the student then answers five
    problems on that skill incorrectly, **then** the stored mastery level is
    still `SECURE` and the level displayed to the student is still `SECURE`.
    *(Mastery level never decreases in M2. If a later milestone wants decay, it
    must say so explicitly and answer AC 20 again — see M7.)*
20. **Given** any payload rendered to a student-facing surface, **when** it is
    inspected, **then** it contains no accuracy percentage, no 0–100 score, no
    streak counter and no value that is lower than the same value was on a
    previous render for the same skill.
21. **Given** a completed practice set, **when** the student reaches the end,
    **then** they see a summary naming the skills practised and how many problems
    they answered, framed as progress rather than as a mark, and the set status
    becomes `COMPLETE`.

### Session shape, isolation and lifecycle

22. **Given** a practice set left half-answered, **when** the student returns to
    it later, **then** it resumes at the first unanswered problem with prior
    attempts intact.
23. **Given** a practice set, **when** it is generated, **then** it has a bounded
    size from configuration — it does not grow, does not refill itself, and has
    an end.
24. **Given** account A signed in, **when** it requests a practice set, practice
    problem, attempt or mastery record belonging to account B, **then** the
    response is HTTP 404 and no content is disclosed.
25. **Given** a student profile with practice data, **when** the profile is
    deleted (M0 AC 46) or the extraction it came from is deleted (M1 AC 34),
    **then** its practice sets, practice problems, attempts and mastery records
    are removed.
26. **Given** a student who has already generated the configured hourly maximum
    of practice sets, **when** they request another, **then** the response is
    HTTP 429 with the typed error shape and no AI call is made.
27. **Given** a practice generation request, **when** the outbound request to
    Anthropic is captured, **then** it contains the problem text, subject and
    grade level, and contains no display name, avatar id, account email, user id
    or student profile id.

## Out of scope for this milestone

Deliberately deferred; leave the seams, do not build them:

- **M3 chat about a specific attempt.** The attempt row is the join point — a
  chat session will later be opened against a graded attempt. Do not add
  conversation fields to the attempt row.
- **M4 lesson from a wrong answer.** The "explain this to me" button on a revealed
  answer is M4's entry point. AC 12 reveals text only.
- **M7 spaced repetition and the parent report.** The mastery record is M7's
  input. Do not add `nextReviewAt` scheduling logic now, but do not design the
  mastery record so that a review timestamp cannot be added to it later.
- **Difficulty adaptation across sets** — using the last set's results to change
  the next set's difficulty. M2 records everything needed for it; nothing reads
  it.
- **A topic/skill browse mode** ("practise long division") independent of an
  upload. This is a real product direction and is likely to be the second thing
  users ask for; it is not M2 because M2 has no problem bank.
- **Caching or reusing generated problems across students** for cost. Named so it
  is not designed out; the practice problem row should not assume single
  ownership at the *schema* level in a way that makes a shared bank impossible.
- **CASE-based dynamic loading of standards frameworks.** M2 bundles a static
  taxonomy file. A CASE client is a dependency decision for later.
- **Non-US curricula and non-Common-Core state standards.**

## Open questions

- [ ] **Is M1 extraction accurate enough for generation to be worth anything?**
  **TECHNICAL UNKNOWN, unproven.** M2 is built on the assumption that the problem
  text coming out of M1 is right. It has never been measured on real worksheets.
  A misread source problem produces five confidently wrong practice problems, and
  the student has no way to know. The `CONFIRMED` gate (AC 3) and the M1
  correction affordance are the only mitigations, and both depend on a child
  noticing the error. **Measure extraction accuracy on a real worksheet corpus
  before treating any mastery number here as meaningful.** Non-blocking for
  building M2; blocking for believing its output.
- [ ] **Which standards taxonomy, and in what form?** **PRODUCT + TECHNICAL.**
  The research recommends Common Core (math and ELA) plus NGSS, with 1EdTech CASE
  as the machine-readable format. **ASSUMPTION pending an answer: bundle a static
  JSON subset of Common Core math and ELA for grades K–8, checked into the repo,
  with `{ code, descriptor, gradeLevel, subject }`.** Blocking for AC 7–9 in the
  sense that the file must exist; not blocking on any external service.
- [ ] **How is answer equivalence judged (AC 13)?** **TECHNICAL UNKNOWN.** Three
  options: ask the model to grade with the answer key in context; normalise and
  compare strings; add a computer-algebra dependency. The third is a new major
  dependency and needs the owner's approval. The first is untested for
  reliability on child-written answers. **Needs a measured fixture run before the
  approach is fixed.** Blocking for AC 13.
- [ ] **How many problems per set, and how many attempts before the answer is
  revealed?** **PRODUCT.** ASSUMPTION: six problems, three attempts. Non-blocking
  provided both are configuration.
- [ ] **Should a practice set mix difficulty, or match the source problem's
  level?** **PRODUCT.** ASSUMPTION: same level as the source, with the last
  problem one step harder. Non-blocking.
- [ ] **Does mastery ever decay, and if so what does the child see?**
  **PRODUCT.** M2 says flatly that it does not (AC 19). M7 wants review
  scheduling, which is decay by another name. The two must be reconciled in M7
  and the answer must not end up as a level that visibly drops. Non-blocking for
  M2; **blocking for M7.**
- [ ] **Which subjects can actually be graded?** **PRODUCT.** ASSUMPTION: math
  and short-answer science only at first; reading comprehension and writing are
  generated but not auto-graded, or are excluded from M2 entirely. Non-blocking
  if the unsupported case is refused cleanly rather than graded badly.
- [ ] **Does generation fit inside a Vercel function invocation?**
  **TECHNICAL UNKNOWN**, inherited from M1's equivalent question. If not,
  generation becomes a background job and the set status machine in AC 5/6
  becomes load-bearing. Measure before implementing AC 6. Non-blocking — the
  status machine is specified either way.

## Data touched

M2 is the first milestone that records **how well a specific child performs**.
That is a materially more sensitive category than M1's "what this child was
assigned": a wrong answer is a record of a minor's academic difficulty, and an
accumulation of them is a profile of what they struggle with.

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Generated practice problem text | Student | Medium — reveals what the child is working on | Postgres |
| Answer key and accepted alternate forms | — | Low, but must never reach the client pre-attempt (AC 17) | Postgres |
| Skill code, descriptor, grade level per problem | Student | Low–medium; implies the child's working level, which may differ from their grade | Postgres |
| Submitted answers | Student, usually a minor | **Medium–high — a record of academic performance** | Postgres |
| Grade result, attempt count, timestamps, elapsed time | Student | Medium | Postgres |
| Per-skill mastery record | Student | **Medium–high — a durable profile of what this child cannot do** | Postgres |
| Practice set status and ordering | Student | Low | Postgres |

**New tables this milestone adds** (named for the architect, not designed here):
`PracticeSet`, `PracticeProblem`, `Attempt`, `SkillMastery`, plus a bundled,
non-personal skill taxonomy that is reference data rather than student data.

**Transmitted to third parties.** Problem text, subject and grade level go to
Anthropic for generation and, depending on the answer to the equivalence
question, for grading. AC 27 requires that no identifier travels with it — the
model needs to know that this is a grade-4 fractions problem, never who the child
is. Nothing about attempts, mastery or grades is sent to any analytics, logging
or error-reporting service.

**Retention — owned by M0.** Two rows of M0's published table govern M2: *extracted
problem text* (life of the `ACTIVE` profile) covers generated practice text by the
same reasoning, and *mastery / strengths-and-weaknesses record* (life of the
`ACTIVE` profile) covers the mastery record and the attempts that produce it. **M2
states no duration.** If the owner decides attempts should expire sooner than
mastery — a reasonable position, since the aggregate is the product and the
individual wrong answers are not — that is a new row in M0's table, added there,
not a number written here.

**Deletion.** M2 data is removed by every path M0 and M1 already define: profile
deletion, the parent's §312.6 request, account closure, and — new here — deletion
of the extraction the practice came from (AC 25). Nothing in M2 lives outside
Postgres, so there is no blob-orphan equivalent in this milestone.

**ASSUMPTIONS made in this spec** (each was a guess):

- Practice is generated from a whole confirmed extraction, not one problem at a
  time; a set spans the skills on that page.
- Six problems per set, three attempts before reveal, one primary skill code per
  problem. All configuration.
- The mastery ladder has four levels and is monotonic within M2.
- `claude-opus-5` with schema-validated structured output generates the problems,
  matching M1's mechanism and ADR-0005.
- Grading runs server-side on submission, synchronously, and returns fast enough
  to feel immediate. If it does not, it needs the same status machine as
  generation.
- A practice set belongs to exactly one student profile and is never shared.
- The taxonomy is bundled static reference data, not a runtime API call.
- Every threshold here — set size, attempt count, grade band, hourly cap,
  generation time limit — lives in one configuration module, not as literals.
