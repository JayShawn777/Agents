# Spec: Interactive whiteboard lessons

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** product-spec agent
- **Milestone:** M4
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) the
  `LessonScript` schema and its drawing-primitive vocabulary, (b) whether lesson
  authoring runs in-request or as a background job, and (c) whether an authored
  script may be reused across students. Depends on ADR-0005 (structured output).
  Research: [anthropic-api.md](../research/anthropic-api.md),
  [tutoring-product-patterns.md](../research/tutoring-product-patterns.md).

## Problem

Some things cannot be explained in a paragraph. "Line up the decimal points",
"the 5 goes here, not here", "this angle and that angle are the same one" are
spatial statements, and a wall of text asking a nine-year-old to hold four
positions in their head at once is how you lose them. The chat tutor (M3) can
only talk. A student who is still stuck after being told twice has nowhere left
to go, and the thing a real tutor would do next — pull the page over and draw it
— is the one thing the app cannot do.

## Goal

For a problem the student has already attempted, Claude authors a validated,
step-by-step lesson script of drawing operations paired with narration lines, and
the browser animates it on a canvas under the student's control.

**This is an engagement bet, not a pedagogical claim.** The research is explicit:
controlled studies find worked examples and video-modelled examples produce
comparable learning outcomes, and student preference for video does not track
with better comprehension. We are building this because a drawn, paced
explanation is more likely to hold a child's attention than a wall of text — not
because it teaches better. Nothing in this product should claim otherwise, and
AC 16's static transcript is a first-class alternative rather than a degraded
fallback.

## Non-goals

Named because a reader will assume several of these are here:

- **This is not video.** No video file is rendered, encoded, stored, streamed or
  served (AC 4). No ffmpeg, no headless-browser capture, no MP4. The browser draws
  from a script at play time.
- **No narration, no audio, no voice of any kind.** The script carries narration
  *text* per step; nothing speaks it. M5 does that, and M4 must leave the timing
  seam for it (AC 7).
- **Not a shared whiteboard.** The student cannot draw, write, annotate, or
  input anything onto the canvas. It is one-way. There is no ink, no stylus
  support, no eraser tool.
- **No free-form illustration.** The renderer supports a closed, fixed vocabulary
  of drawing primitives. A script asking for anything outside it is rejected
  (AC 3), not approximated.
- **No image generation, no photographs, no clip art, no charting library, no
  3D.**
- **No lesson library, browse mode, or catalogue.** A lesson exists against one
  of the student's own problems and is reached from that problem.
- **No lesson reuse across students** in M4, and no cross-student cache.
- **No download, export, share link, or "send this to my mum".**
- **No editing a lesson**, by the student or by anyone else.
- **No lesson for a problem the student has not tried yet** (AC 5). The
  whiteboard is not a way to skip the work.
- **No quizzes, checkpoints or interactions inside a lesson.** Play, pause,
  step, replay — that is the whole interaction model.
- **No M7 adaptation.** Lessons do not yet change based on which lessons the
  student watched or abandoned.

## User stories

- As a student who is still stuck after chatting, I want the tutor to draw it out
  for me, so that I can see where the numbers go.
- As a student, I want to pause and go back a step, so that I can look at the bit
  I missed again.
- As a student, I want to watch it again from the start, so that I can follow it
  a second time now that I know where it is going.
- As a student on a phone, I want the drawing to fit my screen, so that half the
  working is not off the edge.
- As a student who finds the animation distracting, I want to read the steps
  instead, so that I can still get the explanation.
- As a student, I want to say "this doesn't make sense", so that a bad
  explanation is not the end of the road.
- As a parent, I want the explanation to teach the method rather than just fill
  in my child's homework, so that the app is not doing the work for them.
- As an engineer, I want the lesson to be data rather than a rendered video, so
  that we can restyle it, translate it, narrate it and replay it without
  re-generating anything.

## Acceptance criteria

**Preconditions for every criterion.** Lessons require a student profile whose
status is `ACTIVE` (M0 AC 36); a request against any other status returns HTTP
403 with the typed error shape and makes no AI call. A lesson is authored against
a `CONFIRMED` extracted problem (M1 AC 30) or a practice problem (M2 AC 1)
belonging to that profile.

### Authoring

1. **Given** a problem the student has attempted, **when** a lesson is requested,
   **then** a `LessonScript` is produced that validates against the project's zod
   schema, and it is persisted with the source problem id, the model id, the
   effort setting and the prompt version used to produce it.
2. **Given** a generation response that fails schema validation (`parsed_output`
   is null), **when** it is processed, **then** the lesson status is `FAILED`
   with a retry option and **zero** steps are persisted. No partial script is
   written.
3. **Given** a script containing a drawing operation whose `kind` is not in the
   renderer's supported vocabulary, **when** it is validated, **then** the script
   is rejected and not persisted. *(The vocabulary is closed on purpose: an
   unrenderable script must fail at authoring time, never as a blank canvas in
   front of a child.)*
4. **Given** a lesson being authored or played, **when** the session's network
   traffic and the storage bucket are inspected, **then** no object with a
   `video/*` content type is created, requested or served.
5. **Given** a problem with no recorded attempt by this student — no M2 attempt
   and no M3 chat session — **when** a lesson is requested for it, **then** the
   request is refused with the typed error shape and no AI call is made.
6. **Given** a lesson request, **when** it is accepted, **then** its status is
   observable to the client as `PENDING` → `AUTHORING` → one of `READY` or
   `FAILED`, and the client is never left holding an open request while authoring
   runs. *(This is what makes the milestone safe whether or not authoring fits
   inside a single function invocation — see Open questions.)*
7. **Given** a `READY` script, **when** it is inspected, **then** every step
   carries a start offset in milliseconds and a duration, and the player takes
   that timeline from an injectable cue source rather than computing it inline.
   *(M5 replaces the cue source with narration timings; if the player owns the
   timing, M5 becomes a rewrite.)*
8. **Given** a script whose step count is outside the configured minimum and
   maximum, or whose narration text for any step exceeds the configured character
   cap, **when** it is validated, **then** it is rejected and one regeneration is
   attempted before the lesson is marked `FAILED`. *(The narration cap exists so
   M5 never has to split a step across two TTS requests.)*
9. **Given** a lesson authoring request, **when** the outbound request to
   Anthropic is captured, **then** it contains the problem text, subject and
   grade level, and contains no display name, avatar id, account email, user id
   or student profile id.
10. **Given** the model declines the request (`stop_reason` of `refusal`) or
    authoring exceeds the configured time limit, **when** it is processed,
    **then** the status is `FAILED`, a plain user-facing message is shown, and no
    stack trace, model identifier, raw provider payload or internal error text
    reaches the browser.

### Rendering and playback

11. **Given** the same `READY` script, **when** it is played twice on the same
    viewport, **then** the canvas contents at the end of each step are identical
    both times. *(The renderer is deterministic: no randomness, no
    wall-clock-dependent layout.)*
12. **Given** a playing lesson, **when** the student pauses, resumes, steps
    backward, steps forward, or replays from the start, **then** each control
    behaves as named, and stepping backward to step *k* produces the same canvas
    as playing forward to step *k*.
13. **Given** the same script, **when** it is rendered at a 375 px-wide viewport
    and at a 1280 px-wide viewport, **then** every drawn element is fully within
    the canvas bounds at both sizes and no two elements overlap illegibly.
    *(Script coordinates are in a normalised logical space, not pixels.)*
14. **Given** a step whose content is mathematics, **when** it is drawn, **then**
    it renders as mathematics using the same LaTeX convention as M1's extracted
    problems.
15. **Given** a browser reporting `prefers-reduced-motion: reduce`, **when** a
    lesson is played, **then** each step's content appears without animation and
    all content remains reachable via the step controls.

    > **NOT MET, and deliberately so as of 2026-08-28.** The M4 review found
    > that the lesson renderer has no animation at all — the one motion-related
    > class changed no value, and ADR-0019 §4's "stroke reveal on the overlay"
    > was never built. The criterion was therefore *vacuously* true, which is
    > worse than plainly false: a `reducedMotion` prop and a passing test made
    > it look implemented. The plumbing has been deleted and ADR-0019 §4's claim
    > struck (see that ADR's 2026-08-28 revision note).
    >
    > The second half — "all content remains reachable via the step controls" —
    > IS met, and independently, by the step controls and by AC 16's static text
    > view.
    >
    > **M5 owns this.** Narration is the first real timeline in the product, and
    > any reveal synchronised to it is precisely the motion this criterion was
    > written for. Reinstate the preference in the same change that adds the
    > first animation, never afterwards.
16. **Given** a `READY` lesson, **when** the student chooses the text view,
    **then** every step's narration text and its drawn content are presented as
    an ordered, static worked example, complete without the canvas.
17. **Given** a lesson for a problem whose answer key is known, **when** the
    fixture lesson set is checked, **then** the final expression written on the
    canvas matches the answer key for that problem. *(A lesson that teaches the
    method to a wrong conclusion is worse than no lesson.)*

### Correction, isolation and lifecycle

18. **Given** a played lesson, **when** the student marks it as confusing or
    wrong, **then** the flag is persisted against that lesson with the step index
    if one was selected, and the student is offered a regeneration.
19. **Given** a lesson, **when** the student asks for a different explanation,
    **then** a new script is authored and persisted as a new version, and the
    previous version remains playable.
20. **Given** account A signed in, **when** it requests a lesson belonging to
    account B, **then** the response is HTTP 404 and no content is disclosed.
21. **Given** a student profile with lessons, **when** the profile is deleted
    (M0 AC 46), **then** its lessons, script versions and flags are removed; and
    **given** the problem a lesson is bound to is deleted, **then** that lesson is
    removed with it.
22. **Given** a student who has requested the configured hourly maximum of
    lessons, **when** they request another, **then** the response is HTTP 429
    with the typed error shape and no AI call is made.

## Out of scope for this milestone

Deliberately deferred; leave the seams, do not build them:

- **M5 narration and personas.** AC 7's injectable cue source and AC 8's
  narration character cap exist solely so M5 is an addition rather than a
  rewrite. Do not generate audio, do not add a voice field to the script, do not
  call a TTS vendor.
- **Cross-student lesson reuse and caching.** The API research points out that
  authoring is the expensive call and its *output* is the most cacheable thing in
  the app — the same lesson for the same skill could be replayed for many
  students. That is an ADR and a privacy question (a script authored from one
  child's worksheet may contain their specific numbers), and it is not M4. Do not
  design the script row so that it can never be shared.
- **Lessons for a whole skill** rather than for one problem — the natural input
  to M7's review loop.
- **M7 adaptation** — choosing the lesson style from what this student responds
  to.
- **Interactive checkpoints** ("you try this step") inside a lesson.
- **Translation or localisation of narration text.**
- **Accessibility beyond AC 15 and AC 16** — screen-reader narration of canvas
  content in particular is a real requirement and is not specified here. Named so
  it is not forgotten, not so it is skipped forever.

## Open questions

- [ ] **Will a lesson-authoring call complete inside a Vercel function
  invocation?** **TECHNICAL UNKNOWN, and the API research names this as the single
  biggest unvalidated assumption in the whole plan.** A `high` or `xhigh` effort
  authoring call with adaptive thinking, producing thousands of output tokens, has
  never been measured. AC 6's status machine is specified so that the answer
  changes the implementation but not the spec — but the answer determines whether
  M4 needs a job queue, which is a substantial piece of infrastructure this
  milestone would then be paying for. **Measure it before the architect commits to
  a shape.** Non-blocking for the criteria; blocking for the plan.
- [ ] **What is in the drawing primitive vocabulary?** **PRODUCT + TECHNICAL.**
  The API research sketches `write(latex, at)`, `circle(target)`,
  `arrow(from, to)`. Real explanations also want underline, strikethrough,
  bracket/brace, number line, simple grid, and a way to reference a previously
  written element by id. **ASSUMPTION: a closed set of roughly eight primitives,
  all 2D, all addressable by element id.** Blocking for AC 3 — the set must be
  fixed before authoring prompts are written, because widening it later
  invalidates every stored script.
- [ ] **Does the renderer need collision avoidance, or does the model place
  elements well enough?** **TECHNICAL UNKNOWN.** AC 13 requires legibility at two
  viewport sizes; if the model's coordinates overlap in practice, we need a layout
  pass, which is real work nobody has scoped. Measure on a fixture set of twenty
  lessons before committing.
- [ ] **Does the lesson explain the student's own problem, or a parallel one?**
  **PRODUCT.** Explaining their exact homework problem risks being a
  do-my-homework machine; a parallel example risks the student not connecting it.
  **ASSUMPTION: the student's own problem, because AC 5 already requires them to
  have attempted it first.** Revisit if lessons start being used to skip work.
- [ ] **How is a wrong lesson (AC 17) caught outside the fixture set?**
  **PRODUCT.** AC 18's student flag is the only mechanism, and it depends on a
  child noticing. There is no review queue. Accept it or fund one. Non-blocking
  for the build.
- [ ] **Are lessons available for non-mathematical subjects?** **PRODUCT.** The
  primitive vocabulary is unashamedly math-shaped. A reading comprehension lesson
  drawn on a whiteboard is a different design. ASSUMPTION: math and science only
  at first; other subjects fall back to text. Non-blocking if the unsupported case
  is refused cleanly.

## Data touched

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Lesson script JSON (narration text, drawing ops) | Student — it is an explanation of *their* problem, containing their numbers | Medium | Postgres |
| Source problem id, model, effort, prompt version | Student (by reference) | Low | Postgres |
| Lesson status, versions, timestamps | Student | Low | Postgres |
| Playback events (played, paused, abandoned at step *k*) | Student | Low–medium — an engagement record about a minor | Postgres |
| Student "this is confusing" flags | Student | Low | Postgres |

**New tables this milestone adds:** `Lesson`, `LessonScriptVersion` (or a version
column on `Lesson`), `LessonFlag`. Playback events are a new row shape and should
be minimal — see the assumption below.

**Transmitted to third parties.** Problem text, subject and grade level go to
Anthropic for authoring; AC 9 forbids identifiers travelling with them. Nothing
generated here is transmitted anywhere else — in particular, no lesson script and
no playback event goes to an analytics service.

**Retention — owned by M0.** M0's published table has no row for lesson scripts
or playback events. **Both need one before M4 ships**, added to M0, not stated
here. A lesson script is derived content and its natural window is the life of
the source problem; playback events are the more interesting question, because an
engagement log about a child accrues indefinitely and has no stated business need
beyond product analytics — which is exactly the sort of "we might want it later"
retention §312.10 is aimed at. Raise it against M0 and default to collecting less.

**Deletion.** Lessons are removed by profile deletion (M0 AC 46), the parent's
§312.6 request (M0 AC 48), account closure (M0 AC 47), and deletion of the source
problem (AC 21). Nothing in M4 lives in blob storage — which is exactly the
property AC 4 protects. If a future decision introduces rendered video, it
reintroduces the orphaned-object problem M0 AC 43 exists to solve, and that cost
should be counted in the decision.

**ASSUMPTIONS made in this spec** (each was a guess):

- A lesson explains one problem, not a whole worksheet or a whole skill.
- The script is authored in a single call with schema-validated structured
  output on `claude-opus-5`, per ADR-0005 and the API research.
- Script coordinates are normalised to a logical canvas (0–1 on both axes) and
  the renderer maps to pixels, which is what makes AC 13 achievable.
- Steps are addressable by a stable id so that M5's cue timeline can key off them
  and a flag (AC 18) can point at one.
- Playback events are limited to start, completion and furthest step reached —
  not a full event stream. A finer-grained log is a product analytics decision
  with its own retention argument.
- Regeneration (AC 19) is unlimited within the hourly cap of AC 22.
- Every threshold here — step count bounds, narration cap, authoring time limit,
  hourly cap, animation durations — lives in one configuration module, not as
  literals.
