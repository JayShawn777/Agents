# Spec: The adaptive loop

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** product-spec agent
- **Milestone:** M7
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) when
  and where the learner profile is re-summarised, and (b) the spaced-repetition
  schedule and how it interacts with the never-decreasing mastery display.
  Depends on ADR-0005 (structured output) and M3's prompt-caching ADR. Research:
  [tutoring-product-patterns.md](../research/tutoring-product-patterns.md),
  [anthropic-api.md](../research/anthropic-api.md).

## Problem

Everything the app has learned about a student is scattered across rows nobody
reads. The tutor meets the same child fresh every time; a skill drilled on Monday
is never seen again, so it is gone by half-term; and the parent who is paying has
no way to answer the only question they actually have — "is this working?" The
product's whole claim is that it adapts to *this* student over time, and at the
end of M6 it demonstrably does not: it adapts within a session and forgets.

## Goal

The app maintains a periodically re-summarised profile of how each student
learns, uses it to shape tutoring and practice, brings skills back for review
before they are forgotten, and shows the account owner a legible picture of what
their child is working on.

## Non-goals

Named because a reader will assume several of these are here:

- **No score that goes down, anywhere a child can see it** (AC 12). This is the
  hardest constraint in the milestone, because spaced repetition is decay by
  another name and the obvious UI for it is a bar that shrinks. M2 AC 19 and AC 20
  are still binding.
- **No comparison to other students.** No percentiles, no rankings, no
  leaderboards, no "children in grade 4 usually…", no class averages.
- **No grade or test-score prediction**, and no claim that using the app improves
  test results. The category's efficacy claims are first-party and unreplicated;
  we will not add ours to the pile.
- **No diagnostic placement test.** M7 infers from work the student has actually
  done. A twenty-minute assessment up front is a different product decision.
- **No teacher, classroom, school or district reporting.** One adult owner
  reading about their own children.
- **No raw-transcript firehose as the parent report.** The parent report is
  summary-level; chat transcripts remain reachable as the separate, secondary
  surface M3 AC 14 already builds.
- **No email digests, push notifications, reminders or streak nudges.** The
  report is in-app. A weekly email is a plausible next thing and is not this.
- **No parent-set goals, assignments, curricula or homework schedules.**
- **No psychometric model.** The schedule is a documented, deterministic interval
  table. No IRT, no Bayesian knowledge tracing, no learned model of the learner.
- **No changes to how practice is generated or graded** beyond passing the
  learner profile into the request (M2 owns generation).
- **No cross-account or cross-profile learning.** Nothing observed about one child
  informs another child's tutoring, including siblings.

## User stories

- As a student, I want the tutor to remember what I find hard, so that I do not
  start from scratch every time.
- As a student, I want to be reminded of things I learned a while ago, so that I
  do not forget them before the test.
- As a student, I want the app to tell me what to do next when I open it, so that
  I am not staring at a menu.
- As a student, I want review to be a short, finishable thing, so that opening the
  app is not an open-ended obligation.
- As a student, I want a skill I once got good at to stay green even if I get
  rusty, so that coming back after a break is not a punishment.
- As a parent, I want to see which skills my child has been working on and which
  are getting better, so that I can tell whether this is worth paying for.
- As a parent, I want to see what the app believes about my child in plain
  language, so that I can tell it when it is wrong.
- As a parent, I want the time-on-task number to be honest, so that a tab left
  open all afternoon is not reported as four hours of study.

## Acceptance criteria

**Preconditions for every criterion.** All M7 behaviour applies to student
profiles whose status is `ACTIVE` (M0 AC 36). The parent report and the learner
profile view are account-owner surfaces; the review loop is a student surface.

### The learner profile

1. **Given** a student profile with practice, chat and lesson history, **when**
   the learner profile is generated, **then** exactly one current record exists
   per student profile holding at least: a plain-language summary, observed
   strengths, observed difficulties, a preferred explanation style, the source
   counts it was derived from, a version number and a `summarisedAt` timestamp.
2. **Given** the configured number of new attempts or the configured elapsed time
   since the last summary, **when** the trigger fires, **then** re-summarisation
   runs once, updates the current record, and retains the previous version;
   **and given** the same trigger fires twice concurrently, **then** only one
   summary is produced.
3. **Given** a summarisation response that fails zod schema validation
   (`parsed_output` is null) or the call fails, **when** it is processed, **then**
   the previous learner profile remains current and unmodified, and no
   user-visible surface breaks. *(A failed summary must never blank the profile.)*
4. **Given** a summarisation request, **when** the outbound request to Anthropic
   is captured, **then** it contains skills, attempt outcomes, grade level and
   subjects, and contains no display name, avatar id, account email, user id or
   student profile id.
5. **Given** a current learner profile, **when** it is rendered into the tutoring
   system prompt, **then** the rendering is byte-identical for the same profile
   version across repeated requests — no timestamps, no unsorted keys, no
   request-scoped values — and three consecutive chat turns report
   `cache_read_input_tokens` greater than zero (M3 AC 8).
6. **Given** a learner profile recording a specific difficulty, **when** the next
   practice set is generated (M2 AC 1), **then** that difficulty appears in the
   generation request and at least one generated problem targets the related
   skill.
7. **Given** a student profile whose status leaves `ACTIVE` — including
   `CONSENT_WITHDRAWN` — **when** a re-summarisation trigger fires for it, **then**
   no AI call is made and no new summary is written.
8. **Given** the configured daily summarisation budget for a profile has been
   reached, **when** another trigger fires, **then** it is skipped and recorded as
   skipped. *(Re-summarisation must never run per turn; it is the quiet way this
   milestone becomes the most expensive one.)*

### Review scheduling

9. **Given** a mastery record with at least one correct attempt, **when** it is
   inspected, **then** it carries a `nextReviewAt` computed from the configured
   interval table and the number of successful reviews so far.
10. **Given** a review answered correctly, **when** the schedule advances, **then**
    `nextReviewAt` moves to the next interval in the table; **and given** a review
    answered incorrectly, **then** it moves to the first (shortest) interval.
    *(Deterministic and testable: a fixture of outcomes produces an exact
    sequence of dates.)*
11. **Given** skills whose `nextReviewAt` has passed, **when** the student opens
    the app, **then** the landing surface offers a review set drawn from those
    skills, bounded to the configured size, with a clear end state; **and given**
    no skills are due, **then** the landing surface offers a different next action
    and never renders an empty or dead-end state.
12. **Given** a skill at mastery level `SECURE` that is overdue for review,
    **when** it is shown to the student, **then** its displayed level is still
    `SECURE` and it is presented as ready to practise again — never as lost,
    expired, downgraded, or as a number that has fallen. *(This is where spaced
    repetition collides with M2 AC 19; the collision is resolved in favour of the
    child.)*
13. **Given** any server-side retention or decay estimate used to compute
    `nextReviewAt`, **when** every student-facing payload is inspected, **then**
    that value is not present in any of them.
14. **Given** a completed review set, **when** it finishes, **then** the mastery
    records for the reviewed skills are updated exactly once each and the student
    sees a completion summary consistent with M2 AC 21's framing.

### The parent report

15. **Given** a student profile with a history of work, **when** the account owner
    opens the report, **then** it shows skills practised, skills reaching each
    mastery level, time on task, and what the app is focusing on next.
16. **Given** a fixture profile with known attempts across practice sets and
    review sets, **when** the report is generated, **then** each count in the
    report equals the count of the underlying rows, with no attempt counted twice
    across a practice set and a review of the same skill.
17. **Given** a student profile with no activity, **when** the report is opened,
    **then** it states that there is nothing to show yet and does not render zeros,
    empty charts or a failure state.
18. **Given** time on task, **when** it is computed, **then** it is derived from
    bounded session records and each session contributes no more than the
    configured per-session cap. *(A tab left open all afternoon must not be
    reported as study time; the report's credibility is the product's
    credibility.)*
19. **Given** the current learner profile, **when** the account owner views it,
    **then** the plain-language summary is shown to them, and **when** they mark it
    as inaccurate, **then** the flag is persisted and a re-summarisation is
    triggered subject to AC 8's budget.
20. **Given** account A signed in, **when** it requests the report, learner
    profile or review schedule of a profile belonging to account B, **then** the
    response is HTTP 404 and no content is disclosed; **and given** two profiles
    in the same account, **when** either report is rendered, **then** it contains
    no data derived from the other.
21. **Given** any student-facing surface, **when** it is inspected, **then** the
    parent report is not reachable from it.

### Lifecycle

22. **Given** a student profile is deleted (M0 AC 46), **when** deletion
    completes, **then** its learner profile records, all archived summary
    versions, review schedules and session records are removed.
23. **Given** the retention job runs (M0 AC 45), **when** it processes M7 data,
    **then** the windows it applies are read from M0's configuration and no
    duration is a literal in M7 code.

## Out of scope for this milestone

Deliberately deferred; leave the seams, do not build them:

- **Adaptive difficulty selection** — using the profile to pick the *next
  question* rather than to shape a whole generated set. M7 supplies the input; the
  selection algorithm is a later, separate decision that should not be improvised
  here.
- **Weekly email or push summaries** to the parent.
- **A student-facing version of the report** beyond the mastery display M2
  already specifies.
- **Goal setting, assignments, or a planned curriculum.**
- **Forgetting-curve personalisation** — per-student interval tuning rather than
  one shared table.
- **Multi-child comparison in the parent report**, even within one family.
- **Exporting the report** as PDF or sharing it with a teacher. Named because it
  is the natural first step toward school accounts, which would change which laws
  apply and is a much larger decision than a download button.
- **Using the learner profile to choose a persona or lesson style** (M4/M5
  adaptation).

## Open questions

- [ ] **Does mastery decay, and if so what does the parent see?** **PRODUCT, and
  it is the central design question of this milestone.** M2 AC 19 forbids the
  child's level going down; AC 12 keeps that promise while still bringing skills
  back for review. Whether the *parent* should see something more honest — "this
  was secure in March, it is probably rusty now" — is undecided, and the two views
  diverging is either the humane answer or a credibility problem. **Blocking for
  the report's design**, not for the review loop.
- [ ] **What are the review intervals?** **PRODUCT.** **ASSUMPTION: 1, 3, 7, 16
  and 35 days, advancing on success and resetting to the first interval on
  failure.** These are conventional, not derived from anything about our content
  or our users. Non-blocking provided the table is configuration.
- [ ] **What triggers re-summarisation, and where does it run?** **TECHNICAL.**
  Cron, on-write after N attempts, or lazily on the next read. Lazy is cheapest
  and makes the first request of a session slow; cron is predictable and pays for
  profiles nobody is using. **ASSUMPTION: triggered on write, executed
  asynchronously, deduplicated.** Blocking for the ADR, not for the criteria.
- [ ] **Do mastery levels mean anything?** **TECHNICAL UNKNOWN, and it is
  cumulative.** M7's entire output rests on M2's mastery records, which rest on
  M2's grading, which rests on M1's extraction — none of which has been measured
  against real worksheets. A confident parent report built on a stack of
  unvalidated inference is worse than no report, because it will be believed.
  **Measure end to end on a real corpus before this report is shown to a paying
  parent.** Non-blocking for the build; blocking for the claim.
- [ ] **How is a session bounded for time-on-task purposes (AC 18)?**
  **PRODUCT + TECHNICAL.** M3 bounds chat sessions and M2 bounds practice sets,
  but "time in the app" spans both plus lesson playback. ASSUMPTION: a session is
  a run of activity with no gap longer than the configured idle threshold, capped
  per session. Non-blocking.
- [ ] **How many summary versions are archived (AC 2)?** **PRODUCT.** Keeping
  every version is a growing record of a child's difficulties; keeping only the
  current one loses the ability to show change over time, which is most of what a
  parent wants. ASSUMPTION: keep a configured recent number, not all. It needs a
  row in M0's retention table either way. Non-blocking.
- [ ] **Should the student see the tutor's summary of them?** **PRODUCT.** AC 19
  shows it to the parent. Showing a child a written assessment of their weaknesses
  is exactly the anxiety pattern the research warns about, and hiding it from them
  while showing their parent has its own problems. ASSUMPTION: parent only.
  Non-blocking for the build, worth deciding deliberately.

## Data touched

M7 creates the most consequential record in the application: a **written
assessment of a specific child's academic weaknesses**, generated by a model,
stored durably, and shown to their parent. Every individual input to it already
exists; the aggregate is new, and it is more sensitive than the sum of its parts.

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Learner profile summary, strengths, difficulties, preferred style | Student, usually a minor | **High — a durable narrative judgement of a child** | Postgres |
| Archived summary versions | Student | High | Postgres |
| Review schedule (`nextReviewAt`, interval index) per skill | Student | Medium | Postgres |
| Server-side retention/decay estimate | Student | Medium — never client-visible (AC 13) | Postgres |
| Session records and time on task | Student | Low–medium — an activity log about a child | Postgres |
| Parent report (derived at read time) | Student | High — same content, presented | Composed from the above |
| Owner's "this is wrong" flags | Student (about) / owner (by) | Low | Postgres |

**New tables this milestone adds:** `LearnerProfile` (current plus archived
versions), `ReviewSchedule` or new columns on M2's `SkillMastery`,
`ActivitySession`, and a summary-flag row.

**Transmitted to third parties.** Skill codes, attempt outcomes, grade level,
subjects and — depending on the summarisation design — excerpts of chat and
lesson history go to Anthropic. AC 4 forbids identifiers travelling with them.
Note the compounding effect honestly: this is the request in the whole
application with the **broadest** view of a single child, because summarisation
is by definition fed everything. The direct notice's description of what Anthropic
receives (M0 AC 13) must cover it. **Nothing about a child's difficulties goes to
any analytics, logging or error-reporting service**, and the learner profile in
particular is exactly the object an error reporter would attach to a failed
request.

**Retention — owned by M0.** M0's table already has a row for the *mastery /
strengths-and-weaknesses record (M7)* at the life of the `ACTIVE` profile, which
covers the current learner profile and the review schedule. Two things it does not
yet cover and which must be added there before M7 ships: **archived summary
versions** and **activity/session records**. **M7 states no durations** (AC 23).

**Deletion.** M7 data is removed by profile deletion (M0 AC 46), the parent's
§312.6 request (M0 AC 48) and account closure (M0 AC 47). Note one consequence
worth stating plainly: because the learner profile is *derived*, deleting the
underlying attempts and transcripts does not delete the conclusions drawn from
them. Any deletion path that removes source data must also remove or regenerate
the summary, or the app will keep an assessment of a child whose data it was told
to forget. Nothing in M7 lives in blob storage.

**ASSUMPTIONS made in this spec** (each was a guess):

- One current learner profile per student profile, with a bounded number of
  archived versions.
- Summarisation uses `claude-opus-5` with schema-validated structured output, per
  ADR-0005, and is a distinct call from tutoring.
- The review interval table is shared across all students and all skills; there is
  no per-student tuning.
- Review sets reuse M2's practice generation and grading rather than introducing a
  second problem pipeline.
- The parent report is computed at read time from stored rows, not
  pre-materialised.
- Time on task is derived from bounded activity sessions with a per-session cap,
  not from raw page-view timing.
- The student never sees the written learner-profile summary; the account owner
  does.
- Every threshold here — summarisation triggers and budget, interval table,
  review set size, session idle threshold and cap, archived version count — lives
  in one configuration module, not as literals. Retention windows are M0's.
