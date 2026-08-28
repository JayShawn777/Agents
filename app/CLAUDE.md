@AGENTS.md

# app

Stack, workflow, conventions, and the Never list are inherited from
`~/.claude/CLAUDE.md`. Only project-specific facts belong here.

## What this is

**An AI tutor app.** A student uploads a photo or PDF of their schoolwork; the
app reads it, generates similar practice, tutors them through it in chat,
explains with interactive whiteboard lessons narrated by a chosen voice, and
adapts to that student over time.

## Where the build is (2026-08-28)

**M0-M3 done and reviewed. M4 BUILT — all nine slices, backend and UI, reachable
from two entry points. 981 tests, 4 live tests skipped by default. All gates
green. M4 has NOT been reviewed, and its retro is not done.**

**The vision path is verified.** On 2026-08-28 a real worksheet went to the real
model for the first time: 35 of 35 problems, every addend pair correct, labels
in order, 0.97 confidence. See `tests/unit/live/`.

A parent can sign up, read the §312.4 notice, give verified consent, add a
student, upload a worksheet, see its problems extracted and correctable, and
generate graded practice from them. The retention jobs enforce what
`/retention` publishes.

| | |
|---|---|
| **M0** accounts, consent, deletion | done, reviewed — 52 criteria |
| **M1** upload, extraction | done, reviewed — 36 criteria |
| **M2** practice, grading, mastery | built, **reviewed** 2026-08-27 — 27 criteria |
| **subject coverage** | fixed 2026-08-27 — math, ELA, reading, writing, science, social studies, history all generate practice |
| **M2.5** checkpoints (quizzes) | **done and reviewed** 2026-08-27 — all 7 slices, spec, plan, ADRs 0016/0017/0018 |
| **M3** chat tutor | **done and REVIEWED** 2026-08-28 — all five endpoints (35-39), the NDJSON transport, `lib/chat/safety.ts` (AC 21), the whole UI with both entry points wired, and the chat path verified against the real API. Three review findings, all fixed. |
| **M4** whiteboard lessons | **BUILT, not reviewed** 2026-08-28 — nine slices: migration + CHECK, authoring status machine, six endpoints (40-45), cascades, stage + player, controls/text view/flag, and the entry point wired into practice and chat. **Slice 9's browser measurement is SKIPPED** — one auth fix away, see its file header. |
| **M5–M7** | specs written, architecture in `docs/plans/m2-m7-implementation.md`, ADRs 0009-0015. Not built. |
| **M8** spoken language | spec written 2026-08-27. Two BLOCKING open questions before architecture. Not built. |

### Start here, in this order

1. **M2 is reviewed** (2026-08-27). Three findings, all fixed: an uncapped
   attempts route that could buy Anthropic calls in a loop (21b72f9), two
   prompts that let a student address the grader marking them (dcd8f7d), and
   the retry route missing the Owner+ACTIVE consent gate every other M2
   mutation had — it could generate new practice for a profile whose parent had
   withdrawn consent, and it had no test file at all, which is why nobody
   noticed.

   Verified clean, so nobody re-derives it: ownership scoping on every DAL
   helper (no IDOR); `withAuth`'s boot-time throw that kills the previous
   fail-open class; answer-key separation end-to-end — DAL select, the
   `revealed` gate in `lib/practice/dto.ts`, and the practice page mapping
   through DTOs before anything crosses to a client component; the mastery
   ratchet's guarded `updateMany`, whose one race under-counts rather than
   inflates; and `mastery-strip`, which renders no percentage, score, streak or
   `n/m` fraction. The carried-forward worry about `mastery-strip` on the
   student page was unfounded.

   `MASTERY_MIN_ATTEMPTS_FOR_REPORT` now exists in `lib/config.ts` but nothing
   reads it. **Whoever builds M7 must wire it in.**

2. **M2.5 is reviewed** (2026-08-27). Two findings, both fixed.

   The one worth remembering: **checkpoints were appearing in the student
   page's "Practice" list**, because that query filtered by profile and not by
   `kind`. Mislabelling was the small half. The real problem was that every
   COMPLETE checkpoint became one click from every other, which is a browsable
   score history — spec AC 13 forbids showing a value lower than one previously
   rendered, and two old results a click apart is that, assembled by hand
   instead of by us. The list now filters `kind: "PRACTICE"` IN THE QUERY, so
   it is structurally impossible rather than remembered, and an unfinished
   check-in is resumable from the Check-in section while a finished one is not
   re-openable from there.

   The second: ADR-0017 claims "checkpoints are removed only when the student
   profile is". The half that an extraction delete cannot reach one was tested;
   the half that profile deletion DOES reach one was not. A checkpoint has no
   `extractionId`, so any deletion path walking uploads and extractions misses
   it by construction — it now has an integration test asserting the set, its
   problems, its answer keys and its attempts are all gone.

   Verified clean: the CHECK constraint is live in the database (proven by the
   integration tests, not just present in the migration file), `lib/practice/
   finalize.ts` is the only writer of `PracticeAnswerKey` for both generators,
   both new routes carry ownership scoping and the create route the ACTIVE
   gate, and `CheckpointResult` is handed one summary with no history so a
   comparison is unreachable rather than merely absent.

3. **The credentials work, and one detail cost time.** `ANTHROPIC_API_KEY` is
   set (2026-08-28). It is an **identity-linked key**, which the API rejects
   with a **400, not a 401** — `anthropic-workspace-id is required when
   authenticating with an identity-linked API key` — so `ANTHROPIC_WORKSPACE_ID`
   is also set and `lib/ai/client.ts` sends it as a default header, but ONLY
   when present, so a classic workspace-scoped key still works. A 400 that reads
   like a malformed body but is really an auth-shape problem is worth
   recognising on sight.

   **`RUN_LIVE_AI=1` is the convention for tests that need the real API**
   (ADR-0012 §4). They live in `tests/unit/live/` and skip otherwise, so a
   normal `pnpm test` costs nothing. `.scratch/` is gitignored and holds test
   inputs — currently a copyrighted third-party worksheet, which must stay out
   of the history.

4. **M3's streaming route is BUILT** (endpoint 37, plan §3.4, ADR-0013), with
   64 new tests. `POST /api/chat/sessions/[sessionId]/messages` returns NDJSON:
   one `turn`, then `delta`s, then exactly one `done` or `error`, never both.

   What it does, so nobody re-derives it: two rows are written **before** the
   model is called, so a turn exists whether or not a reply arrives; the turn is
   idempotent on a client-supplied `clientTurnId` enforced by a unique index;
   abort persists the partial through `after()` and actually cancels generation,
   so a closed tab stops costing output tokens; `max_tokens` sets `truncated`
   and still delivers the reply as a SUCCESS; a refusal or a typed SDK error
   becomes a terminal `error` event carrying an allowlisted string, with no
   `stop_details`, model id or exception text on the wire; and an idle gap past
   `CHAT_IDLE_TIMEOUT_MS` aborts, persists the partial and emits `TIMEOUT`.

   **Two things in ADR-0013 were wrong and are revised in place** (its
   2026-08-28 note). §3's "resumes streaming into the same row" is not
   implementable — **assistant prefill returns a 400 on Opus 5**, so a truncated
   reply cannot be continued. A STALE partial is regenerated into the same row
   instead; a FRESH partial is replayed rather than regenerated, because
   otherwise two concurrent requests carrying one `clientTurnId` both generate
   into the same row. And §6's `apiStream` yields a terminal error event rather
   than throwing, which is §2's own client rule moved into the signature.

   `CHAT_EFFORT` is new and is `low`, unlike `EXTRACTION_EFFORT`'s `high`.
   Thinking runs before the first text delta, so effort — not the prompt — is
   what spends AC 2's three-second first-token budget. Thinking stays ON:
   disabling it is the documented way to leak `<thinking>` tags, and a
   nine-year-old reads this output. **Plan §9.1's measurement now has somewhere
   to land** — the route logs time-to-first-token when it exceeds budget — and
   that measurement should fix `CHAT_EFFORT`, `CHAT_FIRST_TOKEN_BUDGET_MS` and
   `CHAT_IDLE_TIMEOUT_MS`, all three still guesses.

   **The session-open routes are BUILT too** (endpoints 35/36, +27 tests).
   `POST /api/extracted-problems/[problemId]/chat-sessions` and
   `POST /api/attempts/[attemptId]/chat-sessions` both call one
   `openChatSession`, so the two entry points cannot drift. Opening is FREE and
   deterministic: no model call, a templated opener quoting the problem (AC 1),
   the bounds stamped from config, and the learner context rendered exactly once
   and snapshotted with its hash (ADR-0012 §2) — which is what makes AC 8 true
   by construction rather than by discipline.

   **One gate there is mine, not the plan's: a profile with no `gradeLevel`
   gets a 409.** The alternative was `gradeLevel ?? "GRADE_4"`, which this file
   already carries as a known smell in the attempts route — and here it would
   mean guessing a child's reading level for a whole session and then
   snapshotting the guess onto a row cached for an hour. ADR-0009 §4's "refuse
   cleanly rather than do it badly", applied. If that turns out to be too strict
   in practice, the fix is to make grade level required at profile creation, not
   to reinstate the default.

   **Endpoints 38 and 39 are built too.** `GET /api/chat/sessions/[sessionId]`
   serves reconnect, AC 19's retry and AC 14's parent transcript read, and
   lazily closes a session past its bounds (the `reapIfStale` shape — M3 needs
   no cron job). Its auth is **Owner, not Owner+ACTIVE, deliberately**: a parent
   who has just withdrawn consent must still be able to read what the tutor said
   to their child, which is exactly when they are most likely to want to.
   `POST .../close` is idempotent for a session the student already closed and
   409s for one closed by a bound — the plan's row says both "idempotent" and
   "409 if already closed", and that is the reading that makes both true.

   **The UI is built too** (F24-F27), and both entry points are WIRED, not just
   written: "Ask about this one" on every problem of a CONFIRMED extraction, and
   "Ask the tutor why" after a wrong or unscored answer in the practice runner —
   M2 AC 10's join point and the user story the milestone exists for. The
   parent's transcript list is linked from the student page. The M2.5 retro's
   lesson was that an entry point buried in a bigger slice never gets built, so
   it was kept separate and then actually connected.

   **One improvement over plan §4 worth knowing.** The plan accepts a departure
   from ADR-0005 — a lazy KaTeX chunk on the chat route, because a partial
   reply's LaTeX cannot be server-rendered mid-`\frac`. That turns out to be
   unnecessary: the terminal `done` event carries a full `ChatMessageDTO` whose
   `contentHtml` was ALREADY rendered server-side before it went on the wire. So
   the streaming bubble shows plain text while streaming and is replaced by the
   server's HTML the instant the reply lands. **No KaTeX JavaScript ships to the
   browser anywhere in this app**, and ADR-0005 holds with no exception.

   Two smaller deviations, both deliberate: no `ScrollArea` on the chat page
   (the transcript is server-rendered and scrolls with the document, which keeps
   the composer reachable on a phone where two scroll regions would fight), and
   the component tests use `fireEvent` rather than `@testing-library/user-event`
   — the latter is not a dependency and the Never list forbids adding one
   without asking.

   **AC 21 (distress) IS built** — `lib/chat/safety.ts` (plan B38), which an
   earlier note in this file wrongly called unspecified. A deterministic,
   local phrase check runs on the student's message before the stream is
   constructed; on a hit the fixed `DISTRESS_SAFETY_MESSAGE` is written with
   `safetyResponse: true` and **no request reaches Anthropic** — placed above
   the client construction so that is structural rather than a branch someone
   can reorder past.

   It is deliberately not a classifier: the reply a distressed child reads must
   be text a person chose, it has to work when the API is down, and a child who
   has just typed something hard should not watch a spinner. The patterns key on
   SELF-REFERENCE (*myself*, *me*, *my life*), not vocabulary — a keyword bag on
   "kill"/"die"/"hurt" fires on every history and reading fixture in the test
   file, and this app is not a maths app. **The plan says plainly that its false
   positives and false negatives are not measurable in CI**; the fixtures pin
   behaviour, they do not measure safety.

   Both hand-written CHECK constraints so far live only in migrations and are
   invisible in `schema.prisma`; each has an integration test that is its real
   documentation. The plan's §1.2 SQL for the M3 one was snake_case and would
   not have applied — Prisma generates camelCase.

   **M3 is reviewed** (2026-08-28). Three findings, all fixed.

   **The one that mattered: AC 12's partial persist never ran.**
   `lib/chat/stream.ts` called `after()` from inside the `AbortSignal` listener.
   `after()` reads Next's request context out of `AsyncLocalStorage` and THROWS
   without one — and that context propagates through the stream's own `await`s
   but **NOT into an abort listener**, which runs in the context of whoever
   called `abort()`. So the abort path threw inside an event listener, nothing
   was persisted, and nothing reported it. Confirmed empirically before fixing
   (`AsyncLocalStorage.getStore()` is `undefined` in that listener) rather than
   argued from the docs. `after()` is now registered EAGERLY, once per turn, in
   context; the listener only hands it the accumulated text.

   **The test could not have caught it, and that is the second lesson.** It
   mocked `after` and asserted the mock was called — which proves nothing about
   whether the real function would have worked, and the mock ALSO ran its
   callback immediately, which production never does. The mock is now faithful
   (it defers until the test says the response finished), and there is a
   regression test asserting `after` is registered *before* any abort. **When
   the thing in doubt is whether an API is callable at all, mocking it is how
   the doubt survives the test suite.**

   **Second: AC 16's cascade had no test** — the third appearance of this exact
   gap (ADR-0017's checkpoint cascade was half-tested; the M2.5 review added the
   other half). `tests/integration/chat-deletion-cascade.test.ts` now covers all
   three paths against real Postgres: deleting the extracted problem, deleting
   the ATTEMPT (the binding any routine walking uploads and extractions misses
   by construction), and `deleteStudentData`. The cascades did work — but
   nothing had ever checked, and chat messages are the most sensitive category
   in the product.

   **Third: a read path wrote to a withdrawn profile.** `GET .../[sessionId]`
   and the chat page both called `closeIfPastBounds`, which writes a status
   transition and a wrap-up message — on a path a parent reaches *after*
   withdrawing consent. Now gated on `ACTIVE`.

   Verified clean, so nobody re-derives it: every chat MUTATION carries the
   Owner+ACTIVE gate (the exact hole the M2 review found in the retry route);
   both new caps exist, so neither route can buy model calls in a loop;
   `renderedContext` cannot reach a client (`toChatSessionDetail` plus the
   exact-key-set DTO test); the Anthropic SDK's `APIError` carries only the
   RESPONSE body, so `console.error(err)` cannot log a child's message — the
   leak the spec names by hand; and `renderMathText` escapes every non-math span
   and runs KaTeX with `trust: false`, so `dangerouslySetInnerHTML` is safe on
   model output.

   Known and accepted, not fixed: two concurrent turns can overshoot
   `maxStudentTurns` by one (the bound is checked at step 5, incremented in the
   transaction); a distress turn consumes one of the session's turns; and
   `CHAT_SESSIONS_PER_HOUR` is per profile, not per account — the same shape as
   the generation cap already listed under "Known gaps".

   **The M3 retro is done** (2026-08-28, appended to
   [docs/retros/m0-m3.md](docs/retros/m0-m3.md) — a running document, renamed
   per milestone). Three lessons, two of which changed an agent definition:

   - **17 — a mock stands in for exactly the thing in doubt.** Twice now (M1's
     vision path, M3's `after()`). Asserting a mock was called answers a
     different question than "would this work", and a mock whose timing is more
     forgiving than production's invents a passing path. → `qa-tester`.
   - **18 — an ADR's claims about a vendor are hypotheses, not decisions.**
     M3's ADRs asserted three false things about the outside world, all
     falsified within hours of implementation starting. → `architect`.
   - **19 — a declared cascade is invisible to the unit suite.** Third
     occurrence, and the second *after* lesson 13 was written. Now a checklist
     item rather than a habit. → `qa-tester`.

   Agent edits are mirrored into `~/.claude/agents/` per the convention below,
   and belong in their OWN commit, separate from the feature work.

   **M4 is started, and the gating measurements are done.** Plan §9.2 says
   "M4's contract must not be written until these return". All five have —
   see [docs/research/m4-authoring-measurement.md](docs/research/m4-authoring-measurement.md).
   The four results that change the design:

   - **Authoring takes 12-59s** (p50 35s), 10-20x a chat turn. In-request
     authoring is dead. But `after()` runs for the route's `maxDuration`, so
     **no job queue** — §9.2's expensive branch, "a new dependency, a new
     approval and a new operational surface", is avoided. M4 gets the same
     `PENDING → AUTHORING → READY | FAILED` shape extraction and practice
     generation already use, which plan §3.5 notes is the THIRD instance and
     should now be extracted into one generic.
   - **The eight primitives held** — 0 schema rejections, 0 refusals, 6 of 6
     referentially clean, 7 of 8 primitives used. Freeze recommended,
     provisionally: six fixtures is not the twenty §9.2 asked for.
   - **Non-maths lessons work, and the spec assumed they would not.** M4's open
     question assumes "math and science only at first, other subjects fall back
     to text". The READING fixture produced the best lesson of the six. That
     assumption should be struck.
   - **Canvas 2D is out.** KaTeX emits nested `<span>` HTML with no `<svg>`
     (measured), so a 2D context cannot draw it — the gap §9.2 predicted in the
     spec's "canvas" framing. **[ADR-0019](docs/adr/0019-lessons-render-as-positioned-html-under-an-svg-annotation-overlay.md)**
     picks positioned HTML under an SVG annotation overlay, and because a script
     is stored before it is played, every `write` op's LaTeX is server-rendered
     — **no KaTeX JavaScript ships to the browser anywhere in this app now.**

   Two smaller findings with teeth: a transient error killed 1 of 6 runs at
   `maxRetries: 0`, so AC 2's retry is load-bearing rather than decorative; and
   `label` text reaches 65 characters (schema allows 120), so labels must wrap,
   which changes the height annotations are drawn around. The three maths
   fixtures would never have surfaced that one.

   **M4's contract was approved by the owner and ALL NINE SLICES ARE BUILT** —
   [docs/plans/m4-lessons-implementation.md](docs/plans/m4-lessons-implementation.md).
   Migration `20260828001314_m4_lessons` (three models, one hand-added CHECK),
   the authoring status machine, endpoints 40-45, the cascade test, the stage
   and player, controls/text view/flag, and the entry point.

   **START HERE FOR M4.** What is worth knowing before touching it:

   - **Authoring is `after()`-scheduled, never in-request** (12-59s measured).
     `PENDING → AUTHORING → READY | FAILED`, with `reapIfStale` on the GET so a
     killed function still reaches a terminal state. No job queue.
   - **`authorLesson` REFUSES rather than defaults** when a profile has no grade
     level or no resolvable subject. `resolveSkill(...)?.subject ?? "MATH"` is
     how this project nearly shipped a maths app; both are gated at the route
     with a 409.
   - **AC 5's gate is read generously and is UNVALIDATED.** A lesson needs an
     attempt or a chat session on the problem. A student never attempts an
     EXTRACTED row — M1 extracts, M2 generates practice *from* it — so an
     attempt on any derived practice problem counts, via
     `sourceExtractedProblemId`. Requiring an attempt on the extracted row
     would have refused every lesson. Nobody has checked it is the RIGHT gate.
   - **The hourly cap counts authoring RUNS, not lessons.** Counting lessons
     left regeneration uncapped per hour.
   - **AC 19's guarantee is what regeneration does NOT do**: `currentVersionId`
     is repointed only by `authorLesson`, only on success, so a failed
     regeneration leaves the child with the lesson they had.
   - **AC 12 needed no implementing.** The canvas is a fold over steps 0..k, so
     backward and forward are the same computation.
   - **`lesson-view.tsx` exists** because `LessonPlayer` uses a render prop and
     a server component cannot pass a function across the boundary.

   Three decisions in the plan were mine, not the spec's, and are the parts
   worth arguing with: `LessonFlag.reason` is a four-value allowlist rather than
   free text (a free-text box on a child-facing surface is an unbounded
   personal-data channel with a retention row behind it); there is no "record
   playback" endpoint even though plan §3.5 sketched one; and extracting the
   generic status machine — §3.5 is right that the third instance is due — is
   deferred to a follow-up slice rather than done while the third is being
   written.

   **NEXT, in this order.** (a) **Slice 9's browser measurement is SKIPPED and
   is one auth fix from running** — the seeded session cookie is not accepted by
   `auth()` (probed: `authjs.session-token=<token>` still 401). The spec's own
   header carries the probe results and the next three things to check. Until it
   runs, **M4-3's legibility pass remains an ESTIMATE**, and nothing has ever
   seen a rendered lesson in a browser. (b) **The M4 review** — M2, M2.5 and M3
   each turned up real findings, one of which had shipped. (c) **The M4 retro.**
   (d) Then M5, narration.

   Nothing in M3 is outstanding except the owner decisions in item 5, which are
   all now made.

   **The chat path is VERIFIED against the real API** (2026-08-28,
   `tests/unit/live/chat.live.test.ts`, three real streamed turns). Three
   assumptions became facts:

   - **AC 8's cache actually engages.** Turn 1 paid a **1967-token** cache write
     at `ttl: '1h'`; turns 2 and 3 each READ 1967 and wrote none, billing only
     the new messages as fresh input (94 and 212 tokens). Both breakpoints are
     covered. **Every mocked test in the suite passes identically whether or not
     Anthropic ever cached anything** — the only symptom would have been a bill
     roughly ten times the cost model, silently. This is the one assertion that
     could not be made any other way.
   - **Latency.** First token at **2072 / 1732 / 1749 ms** (turn 1 is slowest —
     it pays the cache write); a whole turn in **2.2-2.9s**. So
     `CHAT_FIRST_TOKEN_BUDGET_MS` (3000) has ~45% headroom and is right;
     `CHAT_IDLE_TIMEOUT_MS` (20000) is ~7x a whole turn and is deliberately
     generous, because killing a slow-but-live reply is worse than spinning a
     few extra seconds on a dead socket; and a ~3s turn against
     `maxDuration = 300` **kills the polling-fallback question outright**.
   - **AC 3 holds live.** Asked "just tell me the answer", the tutor declined
     without scolding, gave a pizza model, and asked a question back. Given a
     child who answered `2/8` by adding both numerators and denominators, it
     found the step where the thinking went sideways and asked about THAT,
     rather than marking it wrong. Replies ran 87-105 output tokens.

   **The caveat, so nobody overstates it:** measured from a development machine,
   NOT from a deployed Vercel function. ADR-0013's follow-up asks for a preview
   deployment and that is still open — the model time will not change, the
   network path might. Nothing here says anything about handwriting, a non-math
   subject, or a session that runs to its bounds.

5. **Owner decisions — both now made, kept for the reasoning.**
   - **`DISTRESS_SAFETY_MESSAGE` (AC 21) is REVIEWED and applied** (2026-08-28).
     A qualified person's guidance: the only responsible thing a homework app
     can do here is point at emergency services and at a trusted adult. The
     message now names 911 and the local police department FIRST, before the
     trusted-adult sentence, and the tutor's system prompt was updated to match
     so the model's fallback says the same thing (`TUTOR_SYSTEM_PROMPT_VERSION`
     → `m3.2`). Record in
     [docs/research/distress-message-review-request.md](docs/research/distress-message-review-request.md).
     **Known limit: `911` is US-specific** — correct for where this app operates,
     wrong the moment it ships anywhere else.
   - **The notification question is DECIDED: the account holder is NOT
     notified** (owner, 2026-08-28). The check is a phrase matcher, not an
     assessment, and an alarm channel driven by it produces false alarms that
     desensitise a parent to a real one — while a child who learns the tutor
     reports them stops telling it anything true. The passive path is the
     mechanism: a distress turn is a stored message, so it already appears in
     the transcript a parent can read (AC 14). Reasoning recorded in the M3
     spec's open questions. Against notifying ON THIS SIGNAL, not against
     notifying ever.
   - **The ADR backlog is cleared.** Sixteen ADRs were accepted by the owner on
     2026-08-28 — every one describing code that is shipped. **Exactly two
     remain `Proposed`, and deliberately so:** 0015 (per-profile narration
     cache, M5) and 0016 (foreign language is proficiency-banded, unbuilt).
     Those describe work nobody has started, so accepting them would claim a
     decision that has not had to be made. A `Proposed` ADR now means something
     again.

### This app is not a math app

Confirmed by the owner on 2026-08-27: the tutor covers **math, reading, language
arts, social studies, science** and, eventually, foreign languages. Math is the
first example, never the scope.

It very nearly shipped as a math app by accident. `GRADABLE_SUBJECTS` was hand
written in `lib/config.ts` as `['MATH', 'SCIENCE']` while the bundled taxonomy
carried math and ELA and **no science at all** — so science worksheets passed the
gradability filter and died as `SLATE_EMPTY`, and ELA's 18 usable skills were
filtered out one step earlier. Only math worked. Every one of the 501 tests that
passed over this used math.

The fix is structural, not a corrected constant. `lib/taxonomy/skills-k8.json`
now bundles four frameworks (CCSS math + ELA, NGSS science, C3 social studies),
`SUBJECT_FAMILY` maps the finer-grained `Subject` enum onto them so `READING`,
`WRITING` and `HISTORY` reach the right skills, and **`GRADABLE_SUBJECTS` is
derived from that coverage** — a subject cannot be declared gradable unless
skills for it exist. See ADR-0009's 2026-08-27 revision note.

**Foreign language, as of 2026-08-27:** the plumbing is done and inert. The
extraction model reports a language, `lib/extraction/language.ts` keeps it only
for a `FOREIGN_LANGUAGE` problem and only if it is in `SUPPORTED_LANGUAGES` —
which is EMPTY on purpose, so every value resolves to null today. That is the
intended state. Turning it on is a data-only change once ACTFL skills are
bundled, and a test asserts the allowlist is still empty so that populating it
without the taxonomy work cannot pass silently.

The skills themselves are still missing:
ACTFL is organised by proficiency rather than grade, so bundling it means
deciding a mapping ACTFL does not publish.
[ADR-0016](docs/adr/0016-foreign-language-is-proficiency-banded-not-grade-banded.md)
settles how — proficiency-banded, with the anchor derived from existing
`SkillMastery` rows by the caller so `candidateSlate` stays pure — but no ACTFL
JSON is bundled yet. A test asserts the subject is non-gradable so that adding
it has to be deliberate.

**Speaking is in scope, and it is not a taxonomy entry.** Confirmed by the owner
on 2026-08-27: the tutor should help a child practise *speaking* a foreign
language, not only reading and writing it. Nothing in M0–M7 can hear — M3
excludes voice by name, M5 is the app talking, M6 records a consenting adult —
so this is a real capability gap, specced as **M8**
([docs/specs/m8-spoken-language.md](docs/specs/m8-spoken-language.md)) and
sequenced after M6 so it inherits M6's consent-gated audio capture.

Two of M8's open questions are **blocking** and no architecture may start until
they are answered: whether the chosen ASR vendor's terms permit audio from
children under 13, and whether its retention can be contractually disabled. A
child's voice is personal information under COPPA. The FTC tolerates audio
collected as a substitute for text and deleted immediately, which is narrower
than pronunciation feedback needs — so M8 stands on a separate, independently
withdrawable voice consent rather than on that allowance. **Never build a
voiceprint of a child**; that is the milestone's brightest line.

Do the written foreign-language track first. It proves the subject through
machinery that already exists, and speaking then has somewhere to attach.

**Before shipping anything subject-specific, ask whether it works for an essay
and a history question, not just an equation.**

### Known gaps, carried forward

- **A student cannot report a bad question.** No endpoint, no control. Extraction
  accuracy is unmeasured and generation quality unproven; a child saying "this
  makes no sense" is the fastest signal available, and there is nowhere to put
  it.
- **There is no child/parent separation in auth** — M0 deliberately has no
  student login. So "a child never sees a score that can fall" is enforced by
  which screen renders what, not by permissions. `mastery-strip` currently
  renders on the student page.
- **`renderMathText` exists twice**, identically, in `components/uploads/` and
  `lib/math/`. Delete one once both tracks are stable.
- Review findings left unfixed, deliberately batched rather than one commit
  each: the generation hourly cap is per student profile, not per account (an
  account with five profiles gets five times the spend); `resolveSkill(...)
  ?.subject ?? "MATH"` and `gradeLevel ?? "GRADE_4"` in the attempts route
  silently feed the grader wrong context if a skill code ever leaves the
  taxonomy (unreachable today — all 76 pre-2026-08-27 codes survive in the
  128-skill bundle — but `TAXONOMY_VERSION` bumping is exactly what makes it
  reachable); and the reveal route returns 200 with empty strings when an
  answer key is missing, masking an invariant violation as success.

### What is verified now, and what still is not

**The vision path is verified** (2026-08-28), and this section used to say the
opposite. One real worksheet — a printed Addition Doubles 10-20 sheet, 1159x1500
webp — went to the real model through the production prompt, schema, model and
effort: **35 of 35 problems, every addend pair correct**, labels 1-35 in order
with no gaps or duplicates, 0.97 confidence throughout, zero student answers on
a blank sheet, and the vertical layout preserved as LaTeX rather than flattened.
It read the repeats correctly (three separate 14+14s, 18+18 twice in a row),
which is what catches a model pattern-matching instead of reading. 36 seconds,
4,081 input / 4,391 output tokens.

`tests/unit/live/extraction.live.test.ts` is that run, kept. It imports the
prompt, schema, model and effort from production rather than restating them, so
it cannot drift from what actually runs.

**What that does NOT prove**, and nobody should claim it does:

- Only a clean, high-contrast, printed **math** worksheet. Nothing yet about
  handwriting, an angled phone photo, or a reading passage. The most
  informative next test is a **non-math page** — the "it very nearly shipped as
  a math app" incident came from exactly that blind spot.
- Nothing downstream. `SLATE_EMPTY`, skill resolution, practice generation and
  grading all still stand on their own mocks.
- **A student still cannot report a bad question.** Extraction accuracy is now
  sampled at n=1; generation quality is still unmeasured.

Storage runs on a local filesystem adapter (`STORAGE_DRIVER=local`); the Vercel
Blob implementation is unbuilt and its placeholder throws.

Start at [docs/README.md](docs/README.md); read
[docs/retros/m0-m3.md](docs/retros/m0-m3.md) before running the pipeline —
it now runs through M3.

Because the app tutors minors, anything touching student data carries **COPPA**
consent and retention obligations. Treat uploaded schoolwork as sensitive
personal data about a child, not as an ordinary file.

FERPA does **not** apply to the current direct-to-consumer design and will not
until a school contracts with us and exercises direct control over the records.
Overstating it obscures the obligations that are real — see
[docs/research/coppa-childrens-privacy.md](docs/research/coppa-childrens-privacy.md).

## Databases

- **Local (development):** `prisma dev`, server named `app`. `DATABASE_URL` in
  `.env` points at it. **First time on a machine**, the instance does not exist
  yet and `prisma dev start app` prints "No prisma dev servers found to start"
  and does nothing — create it with `pnpm exec prisma dev --name app --detach`.
  After that it exists and stays; if the app cannot reach the database, it is
  simply stopped — run `pnpm exec prisma dev start app`. See runbook §1.
- **Cloud (deployment):** Neon. The connection string lives in `.env.neon`,
  which is gitignored and deliberately separate so day-to-day work can never
  run against production.
- Apply migrations to Neon with `pnpm db:migrate:prod`. `scripts/prisma-prod.mjs`
  refuses `migrate dev` against the cloud — that command can drop the database.
- **`pnpm db:migrate` does not work as written, and the failure is misleading.**
  It dies with `type "GradeLevel" already exists`, naming migration 0001, which
  reads like a corrupt migration history. The real database is fine —
  `prisma migrate status` says "up to date" throughout. The failure is in the
  SHADOW database Prisma builds to diff the schema: `DATABASE_URL` points at
  `template1`, which Postgres uses as the template for every newly created
  database, so the shadow is born carrying the whole existing schema and then
  replaying migration 0001 collides with itself. `SHADOW_DATABASE_URL` in `.env`
  is an empty string, so nothing redirects it.

  `prisma dev` already publishes a dedicated shadow server one port up from the
  main one. Until `.env` is fixed — the guard hook blocks writing to it, so a
  human has to — pass it per command:

  ```
  SHADOW_DATABASE_URL="postgres://postgres:postgres@localhost:51215/template1?sslmode=disable" \
    pnpm exec prisma migrate dev --create-only --name <name>
  ```

  Two more things that cost time on 2026-08-27: `prisma migrate dev` HUNG after
  successfully applying the migration and had to be killed, leaving the client
  ungenerated — if tests suddenly fail with Prisma *validation* errors on a
  column you just added, run `pnpm exec prisma generate`. And to hand-edit a
  migration (ADR-0017 needs a CHECK constraint Prisma cannot express), create it
  with `--create-only`, edit, then apply — the guard rightly blocks editing a
  migration that has already run.

## Project-specific quirks

- `postinstall` runs `prisma generate`. Do NOT remove it and do NOT override the
  build command in Vercel — the generated client is gitignored, so the build must
  recreate it, and Vercel's Install and Build fields are easy to confuse.
- `prebuild` clears `.next`. A stale `.next` makes Turbopack die on Windows with
  exit 3221225477.
- `typecheck` runs `next typegen` first; the route types are gitignored.

## Deployment

Pushing to `main` deploys to Vercel automatically. Migrations do not run on
deploy — apply them with `pnpm db:migrate:prod`.

## Documentation

`docs/README.md` is the map: specs, ADRs, research, and the runbook, with the
naming and immutability rules for each. Read the relevant doc before starting;
write the decision down when it is made, not at the end.

## Agents and skills

The nine pipeline agents live in **`/workspaces/Agents/.claude/agents/`** — the
repository root, NOT `app/.claude/agents/`. Subagent definitions are discovered
only at the project root; a `.claude/agents/` directory inside a subdirectory is
silently ignored. They were briefly kept under `app/` and every change made
there — tool grants, effort, memory, turn limits — was inert while appearing to
be applied. Skills do not share this limitation: `app/.claude/skills/` is
discovered and scoped to files under `app/`.

They are **owned by this repository**,
which supersedes commit `7a00c41` (which had moved them to `~/.claude` so shared
fixes would propagate).

The reason for moving them back: these definitions are meant to improve after
every milestone. Untracked files have no history, no review, and no rollback,
and they do not survive a fresh Codespace — so every lesson learned would be
written somewhere git never sees. Project copies shadow the user-level ones, so
this project now pins its own; improvements to the shared `~/.claude` set no
longer flow in automatically, and that is the accepted trade.

### Staging while agents are running

Never `git add` a directory. Stage explicit file paths instead — the guard hook
now blocks directories, `.` and `-A` outright.

A broad `git add app/docs` in commit `0cb4c99` swept up an architect agent's
in-flight ADR work and committed it under an unrelated message about product
research. Nothing was lost, but the history now attributes ADR-0008 and three
ADR revisions to a commit that claims to be about something else — and a commit
message that lies is worse than no commit message.

It then happened a second time, in `fbc0821`, *after* this rule was written
here — a frontend commit swallowed the backend track's half-written consent
routes. Writing a rule down is not enforcement. It is now a check in
`guard.mjs`, which is where a rule belongs once it has been broken twice.

### Enforced rules vs. advisory ones

`.claude/hooks/guard.mjs` runs on `PreToolUse` and **blocks** — it does not warn:

- editing anything under `prisma/migrations/` (an applied migration has already
  run; correct it with a new migration)
- writing to `.env` (`.env.example` is allowed)
- `git push --force` (`--force-with-lease` passes)
- `npm` / `yarn` install commands
- `prisma migrate dev` aimed at the cloud database

These were previously prose in the Never list, which an agent could break by not
reading carefully. Prefer moving a rule into the guard over restating it: three
enforced rules beat thirty advisory ones. `CLAUDE_SKIP_GUARD=1` is the escape
hatch for deliberate, human-driven exceptions.

`.claude/hooks/verify.mjs` runs `lint` and `typecheck` on `Stop` and
`SubagentStop` — when an agent claims to be finished — rather than after every
edit. Per-edit verification ran the full typecheck dozens of times per feature
for no extra signal.

### The parallel implementation split is deliberate

`frontend-engineer` and `backend-engineer` run in parallel against a fixed API
contract. This was challenged on 2026-08-26 and **reaffirmed by the owner**.

The counter-argument, recorded so it is not re-litigated: current practice
(Cognition, April 2026) argues writes should stay single-threaded and that extra
agents should contribute intelligence rather than actions, because concurrent
writers drift from each other in ways the contract does not catch. The
`docs/research/agentic-architecture.md` file makes this case in full.

We are keeping the split. The contract is fixed by the architect before either
engineer starts, shared files land in a prior phase, and the two tracks touch
disjoint files by design. If drift shows up in practice — two engineers
disagreeing about a type that the contract did not pin down — that is the signal
to revisit, and it belongs in a milestone retro rather than a fresh argument.

### Retro cadence

At the end of each milestone — when the chunk is shipped and working, roughly
every one to two weeks — run a retro before starting the next one:

1. Review what the agents actually got wrong. Where was a spec ambiguous? What
   did the reviewers miss that QA caught, or that nobody caught? Where did an
   agent need correcting mid-run?
2. Write those lessons into the agent definitions in `.claude/agents/`, the
   skills in `.claude/skills/`, or this file — whichever is the right home.
3. Commit the changes separately from feature work, with the commit message
   naming the incident that motivated each edit.

Only act on repeated patterns. A one-off mistake is not evidence, and rewriting
an agent's instructions after every stumble makes them worse, not better.

Agents carry a `memory: project` store between runs, so they are no longer
strictly blank each time. That memory is theirs and is narrow; the documents in
`docs/` remain the shared, reviewable record, which is why they are
version-controlled and why the retro is a real step rather than a good
intention.

A copy is mirrored into `~/.claude/agents/` so edits take effect in a running
session. The repository copy is canonical; refresh the mirror after changing it,
and expect a session restart to be needed otherwise.

Each agent carries an explicit `model:` field. Deciding roles (architect,
product-spec) and verifying roles (code-reviewer, security-reviewer) run on
Opus; executing roles that build against an already-fixed contract
(backend-engineer, frontend-engineer, qa-tester, researcher, docs-writer) run on
Sonnet. Cheap generation, expensive verification. Do not change a model field
without saying why in the commit message.

## Available reference skills

`.claude/skills/prisma-*` are vendored Prisma 7 references (full copies, kept in
sync with `.agents/skills/` — despite earlier notes, they are duplicated
directories, not symlinks). Prisma 7 has breaking changes from earlier versions
— consult them rather than relying on memory.
