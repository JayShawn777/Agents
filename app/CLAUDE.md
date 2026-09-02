@AGENTS.md

# app

Stack, workflow, conventions, and the Never list are inherited from
`~/.claude/CLAUDE.md`. Only project-specific facts belong here.

## What this is

**An AI tutor app.** A student uploads a photo or PDF of their schoolwork; the
app reads it, generates similar practice, tutors them through it in chat,
explains with interactive whiteboard lessons narrated by a chosen voice, and
adapts to that student over time.

## Where the build is (2026-09-02)

**M0-M4 done, reviewed and retro'd. M5 BUILT, REVIEWED and its findings FIXED —
all twelve slices, the vendor measured before the architecture, four narrow
reviews, fifteen findings, fourteen fixed. 1208 tests, 6 live tests skipped by
default. All gates green. The M5 retro is done
([docs/retros/m0-m5.md](docs/retros/m0-m5.md)).**

**One M5 finding is deliberately open, and it is an owner decision: the §312.4
direct notice does not name the TTS vendor.** `DIRECT_NOTICE_COPY.thirdParties`
lists Anthropic, Vercel, Neon and the email provider; `DIRECT_NOTICE_VERSION` is
still `2026-08-26.1`, from before M5; and `lib/narration/provider.ts` POSTs a
sentence describing a specific child's homework to ElevenLabs. ADR-0015 calls
naming the vendor a hard precondition before the first narration request. Bumping
the version re-consents **every existing parent**, so the timing is a product
call, not an engineering one. The code change is small.

**Slice 12 was NOT automated, deliberately.** This environment does not enforce
an autoplay policy — `play()` resolves with no user gesture even with
`--autoplay-policy=user-gesture-required` and with Playwright's own override
stripped — so a playback test passes trivially and means nothing. The autoplay
and seam-gap questions are **owner-run measurements needing a real browser**.
Everything downstream of "does one `<audio>` element keep user activation across
`src` changes" is still an assumption; the fallback is concatenation at
generation time, which the plan calls a material redesign.

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
| **M4** whiteboard lessons | **BUILT and REVIEWED** 2026-08-28 — nine slices: migration + CHECK, authoring status machine, six endpoints (40-45), cascades, stage + player, controls/text view/flag, and the entry point wired into practice and chat. Browser measurement RAN; four reviews found 4 blockers, 1 HIGH and 8 more, all fixed. |
| **M5** TTS narration + personas | **BUILT and REVIEWED** 2026-09-02 — twelve slices: the ledger migration, storage/reconciler/purge, the `fetch`-based ElevenLabs client (no SDK dependency), cue derivation, the generation pipeline, endpoints 46/47, the persona picker, the audio player, AC 15's reinstated `prefers-reduced-motion`, and both entry points. ADRs 0020/0021. Four reviews found 15 findings; 14 fixed, the notice bump left to the owner. Slice 12 is an owner-run browser measurement. |
| **M6–M7** | specs written, architecture in `docs/plans/m2-m7-implementation.md`, ADRs 0009-0015. Not built. |
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
   [docs/retros/m0-m5.md](docs/retros/m0-m5.md) — a running document, renamed
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

   **Slice 9's browser measurement RAN on 2026-08-28, and a lesson has now been
   rendered in a browser for the first time.** 987 tests, all gates green.

   **The blocker was not what the spec header said it was.** It blamed the
   seeded session cookie and named three things to check in `lib/auth/config.ts`
   — all three the wrong tree. **`AUTH_SECRET` is commented out in `.env`**, so
   `assertConfig` throws `MissingSecret` before any cookie is read and `auth()`
   returns null for every request. The two probes returned *the same* 401 with
   and without a cookie, and that symmetry was the tell: an unaccepted cookie
   and an unreadable config are indistinguishable at the status code. The dev
   server's own log said `MissingSecret` the whole time.

   **This is an owner action, and it is not about tests: nobody can sign in to
   this app in this environment at all.** The guard hook blocks agents from
   writing `.env`, so a human sets it once:

   ```
   AUTH_SECRET="$(pnpm dlx auth secret --raw 2>/dev/null || openssl rand -base64 32)"
   ```

   Until it is in `.env`, pass it per run: `AUTH_SECRET=... pnpm dev`.

   **What the measurement found, and it is a real defect a child would have
   seen.** At 1280px all three fixtures laid out clean. At 375px the reading
   fixture's `rule` label — "the main idea of the whole paragraph" at `y: 0.14`
   — measured `y -3..77` of a 257px stage: it wraps to four lines on a phone,
   `boxAt` centres it on its point, and the stage clips with `overflow-hidden`,
   so the top line was sliced off. One of three scripts is far above §9.2's 5%
   threshold, which is exactly the condition under which §9.2 says **"a
   deterministic layout pass becomes M4 scope"** — so that pass now exists:
   `clampToBounds` / `offsetToBounds` in `lib/lessons/layout.ts`, applied by the
   stage's existing measure pass as an addition to each element's centring
   transform.

   Three things about it worth not re-deriving: it **shifts rather than
   shrinks**, because the model's coordinate is a claim about arrangement and
   scaling text down is how a lesson becomes unreadable; it derives the next
   correction from the *uncorrected* box, so re-measuring on a resize or a font
   load is idempotent rather than drifting one clamp further each time; and an
   element genuinely bigger than the stage is pinned and left reporting out of
   bounds, so the clamp cannot launder a real overflow into a passing
   measurement.

   **The honest limit: n is 3.** Three fixtures cannot measure a 5% rate. What
   they did was find a defect, which is worth more here than a precise rate —
   but widening the fixture set is the real follow-up, and **the wrapped-label
   shape is the one to add more of**: it is the only shape that failed, and the
   three maths fixtures would never have produced it.

   **M4 IS REVIEWED** (2026-08-28). Run as FOUR narrow reviews after one
   73-file sweep died at its turn limit having reported nothing — scope, not
   capability, was the problem. Thirteen findings fixed. The ones worth keeping:

   - **`reapIfStale` returned a hard-coded FAILED when it LOST its guard race**,
     so a lesson that finished authoring moments before the reaping read was
     shown to the child as a failure while a good READY script sat in the row —
     and a reload made it reappear, so it looked like a flake. Both siblings
     (`run-extraction.ts`, `practice/generate.ts`) already re-read on
     `count === 0`; this file's own docstring promised the same and did not do
     it. **Its test asserted only that no version row was written and never
     looked at the return value — the entire output of the function.**
   - **`PARSE_FAILED` was unreachable.** The SDK's `zodOutputFormat(...).parse`
     THROWS an `AnthropicError` on a schema violation; it does not return
     `parsed_output: null`. So every closed-vocabulary violation and every
     `max_tokens` truncation was classified `UPSTREAM` and told a child "a
     service we depend on is temporarily unavailable" — wrong, and useless
     advice for a deterministic prompt problem. It also pinned the observed
     `PARSE_FAILED` rate at zero, which is the exact signal M4-4 reads.
   - **The hourly authoring cap was a read-then-write count.** Step 7 counted
     outside any transaction and the rows that raise the count were written
     afterwards, so N parallel POSTs all read the same pre-insert count and all
     passed — a cap of six admitting a hundred concurrent 12-59s Opus runs, with
     no middleware and no IP limiter behind it. The count now also runs INSIDE
     a `Serializable` transaction with the insert; P2034 and the cap both map
     to the same 429.
   - **`LESSON_AUTHORING_TIMEOUT_MS` was 120s while every authoring route
     declares `maxDuration = 300`.** A slow-but-alive run was reapable with 180s
     of life left: reaped to FAILED, the UI offered "try again", and pressing it
     started a second paid run while the first was still generating. The
     deadline is anchored to `maxDuration`, not to the measured worst case.
   - **A failed regeneration hid a lesson that still played.** `currentVersionId`
     is repointed only on success — that is AC 19 working — but the page gated
     the player on `lesson.status === "READY"`, and `finalizeFailed` sets the
     lesson to FAILED. The child lost a stored, playable lesson, permanently if
     they were at `MAX_LESSON_VERSIONS`. The page now gates on "is there a
     playable current version".
   - **`failureMessage` was null in every state a writer can produce**, because
     it read the CURRENT version's `failureCode` and the current version is by
     definition the one that did not fail. AC 10's message never reached a
     child. The test "proving" the mapping built a row combination nothing
     writes — retro lesson 17 in a new costume.
   - **Nothing reaped a lesson stranded in `PENDING`**, the state a dropped
     `after()` leaves behind — AC 6's cheaper failure mode, needing no model
     call to fail.
   - **Claiming a PENDING version was check-then-act** (`findUnique` then
     `update`), not a compare-and-swap, 100 lines above a correct guarded
     `updateMany` in the same file.
   - **Every arrow rendered without an arrowhead.** `url(#lesson-arrowhead)` had
     no `<marker>` anywhere in the repository, and an undefined marker reference
     is silently ignored. An `arrow` op carries no coordinates — its whole
     meaning is direction — so "this becomes that" drew as an ambiguous squiggle.
   - **The primary transport button was dead at the end of a lesson.** It called
     `play()`, and `isPlaying` is `playRequested && !atEnd`, so a child who
     reached the last step and pressed the big button got nothing — while it
     announced itself as "Replay" and read "Play" (WCAG 2.5.3).
   - **The authoring poller never stopped on error**, despite a comment saying
     it did: a persistently failing GET fired `router.refresh()` every 2s for as
     long as the tab stayed open.
   - **Three M4 models had no `RETENTION_POLICY` entry**, so lesson data derived
     from a child's schoolwork was retained indefinitely and `/retention` — the
     parent-facing COPPA disclosure, rendered straight off that array — said
     nothing about it. A retention notice that omits a category is not
     incomplete, it is inaccurate.
   - **The e2e seed had no local-database guard**: raw `DATABASE_URL`, real
     `Session` rows, and cleanup by a cascading `DELETE FROM "User"`.

   **Three of those were invisible to the suite by construction, and each got a
   test that fails without the fix** (all three falsified by mutation, not by
   reading): the retention gap is now caught by reading `schema.prisma` and
   failing on any unclassified model; the layout clamp has a jsdom harness that
   stubs `getBoundingClientRect` faithfully — deleting the clamp previously left
   55/55 green; and `LessonPlayer` + `PlayerControls` are finally composed in a
   test, which is the seam the dead button lived in.

   **AC 15 IS STRUCK, by the owner, 2026-08-28.** ADR-0019 §4 claimed
   `prefers-reduced-motion` was honoured by removing "a CSS transition on the
   placement layer and a stroke reveal on the overlay". Neither was ever built,
   so the criterion was **vacuously** true — and a `usePrefersReducedMotion`
   hook, a `reducedMotion` prop and a passing test that asserted a class string
   made it look implemented. Adding an animation purely so a preference has
   something to switch off is backwards, so the claim is struck by a dated
   revision note on ADR-0019, the plumbing is deleted, and the M4 spec records
   AC 15 as NOT met. **M5 owns it:** narration is the first real timeline in the
   product, so the first genuine reveal and the reinstated preference land in
   the same change, never one after the other. The deleted hook was correct —
   `useSyncExternalStore` over `matchMedia` with a `false` server snapshot — and
   is worth recovering from git history rather than rewriting.

   **STILL OPEN, deliberately — all reported, none fixed:**
   - The clamp bounds the BORDER box while `overflow-hidden` clips the PADDING
     box, so a 1px sliver of the original defect remains (use `clientWidth` /
     `clientLeft`).
   - `LessonFlag.versionId` and `Lesson.currentVersionId` have **no foreign key**;
     the flags route's in-lesson resolution is the only thing preventing a
     cross-student write.
   - The DTO key-set tests stop at the top level; the nested op keys are held
     only by the zod re-parse, one `.passthrough()` away from leaking.
   - Background authoring never re-checks consent — a ~60s window after
     withdrawal. **Project-wide, not an M4 regression**: M1/M2/M3's equivalents
     do not either.
   - `lesson-player.tsx` calls `staticCueSource(timeline)` every render and
     discards it; `stepIndex` never resets when `script` changes. Latent until M5.
   - The text view names elements by raw LaTeX ("Circled: \frac{1}{4}") when
     `latexHtml` is right there.
   - `LESSON_PROMPT_VERSION` is still `"m4.0-probe"` and every lesson a child
     sees carries that stamp.
   - The prompt tells the model an annotation may refer to an element in the
     SAME step; the validator rejects it if it appears before its target in that
     step's `ops` array.

   **THE M4 RETRO IS DONE** (2026-08-28,
   [docs/retros/m0-m5.md](docs/retros/m0-m5.md) — the running document, renamed
   per milestone). Five lessons, 20-24, four of which changed an agent
   definition:

   - **20 — a fixture must be a state some writer actually produces.** Fourth
     occurrence of lesson 17's family, and the sharpest: a mock resolved where
     the real SDK throws, and a fixture gave a FAILED lesson a *current* version
     carrying a failure code, which nothing writes. Both coherent, both
     impossible. → `qa-tester`.
   - **21 — assert what a function returns, not only what it wrote.** →
     `qa-tester`.
   - **22 — a coverage test that walks its own registry cannot see an
     omission.** → `qa-tester`, plus the enforced schema check.
   - **23 — a document may not claim an AC is bought by code that does not
     exist.** Lesson 18 was about vendor claims; this is the same failure about
     our own code, which is checkable. → `architect`.
   - **24 — scope a review by file list, not by milestone.** → both reviewers,
     and the dispatch rule below.

   **NEXT: M5, narration — UNBLOCKED as of 2026-09-01.** Both keys are set and
   verified (`AUTH_SECRET` proved end-to-end: a seeded session cookie now returns
   200 where it returned 401, and `MissingSecret` is gone from the log), and
   **M5's gating measurement has RUN** —
   [docs/research/m5-narration-measurement.md](docs/research/m5-narration-measurement.md).
   The architect may now fix M5's shape; it could not before.

   Two results, one of them opposite to what the design assumed:

   - **The with-timestamps endpoint DOES work on the low-latency model** (200,
     262ms, vs 976ms for the quality model — and at half the credit cost). The
     research could not confirm this and the spec named it the one experiment
     that constrains the architecture. It means choosing the quality model for
     M5's pre-generated narration does **not** foreclose a live low-latency
     synced voice later; M5's cache design needs no hedge against it.
   - **The account has 21 current `premade` voices**, so the documented
     2026-12-31 expiry of the legacy set does not bite. Personas can be
     populated from something real — but a voice is an INDIRECTION behind a
     persona (AC 1 is a database row, AC 3 is that row surviving a voice id that
     stops resolving), so naming and designing four to six personas is still an
     owner decision, not a vendor one.
   - **Alignment is character-level, confirmed** — 59 characters, 59 timings, no
     `words` array. Grouping into words is ours, which is why the spec asks for
     an ADR on our own cue format. **The highest-risk unknown left in M5 is how
     mathematics is read aloud**: the test sentence was prose, and M4's scripts
     are full of LaTeX.

   The API key is deliberately **scoped** — `voices_read` and `text_to_speech`
   only, no `user_read`. Keep it that way; a synthesis key has no business
   reading billing.

   **Owner decision, 2026-09-01: captions are ON by default.** Recorded in the
   M5 spec's open questions with the reasoning. The decisive argument is not the
   reading-support trade-off the spec originally framed it as — it is that **a
   deaf or hard-of-hearing child gets nothing from narration at all**, so
   captions off by default makes the milestone inaccessible to them by default,
   and a default is what almost everyone keeps.

   Three constraints come with it, and they are what stop captions re-creating
   the attention-splitting problem M5 exists to solve: a caption is the CURRENT
   step's line and never the whole script; the toggle is persisted per student
   profile, the same shape as the persona selection (AC 4); and AC 16's static
   text view stays a separate, complete equivalent rather than a substitute
   either way.

   **Owner decision, 2026-09-01: the six personas are chosen** and recorded in
   the M5 spec's open questions with their voice ids — Smooth J, Professor
   Sunny, Coach Vale, Professor O, Professor Blaze and Professor Love.

   **The voice ids are SEED DATA, never code.** AC 1 forbids a provider voice id
   as a literal in application code because the stock set carries a published
   expiry — an id compiled into the app is an outage with a calendar entry.

   **Three names in the owner's first list had to change, and the reason will
   recur.** "Barack Obama", "Professor Snoop" ("gonna sound like Snoop Dogg")
   and "Professor Khaled" each named or evoked a real living individual — barred
   by this spec's own AC 2, by right-of-publicity law, and by the TTS vendor's
   terms. The personalities were kept and only the identities dropped. Expect
   this to come up again whenever personas are extended: **the vibe is always
   free, the identity never is.** A single initial ("Professor O") is fine — it
   identifies nobody — provided the artwork and description do not lean back
   toward a likeness.

   **Still to design: the persona artwork**, one preset avatar each in the M0
   style. AC 2 governs the picture exactly as it governs the name.

   **Historical, kept because it explains the shape of the above:**

   M5's first open question is blocking and says so: **"Nothing in M5 can be
   built without this."** A TTS vendor is a **new major dependency**, which the
   constitution says never to add without asking, and commercial use needs a
   PAID plan — the free tier forbids it outright.

   **What is needed: an ElevenLabs paid account, and its key in `.env` as
   `ELEVENLABS_API_KEY`.** `.env.example` now documents it (server-only, never
   `NEXT_PUBLIC_` — it is a billing credential, and narration text describes a
   child's schoolwork). Approving the vendor and approving the dependency are
   the same decision.

   **Two vendor questions must be MEASURED before the architect fixes the
   shape**, and M5's spec says exactly that. `tests/unit/live/narration.live.
   test.ts` is that experiment, written and inert — it skips unless
   `RUN_LIVE_AI=1` and a key is present, and it uses `fetch` with **no new
   dependency**, deliberately: finding out whether the vendor does what the
   research claims must not require first installing the SDK, and if the
   answers come back wrong we will not have installed anything.

   ```
   RUN_LIVE_AI=1 pnpm vitest run tests/unit/live/narration.live.test.ts --project unit
   ```

   - **Does the with-timestamps endpoint work on the LOW-LATENCY model?** The
     research could not confirm it. M5 pre-generates everything so the quality
     model is the natural pick either way; the answer decides whether a future
     low-latency synced surface (a live speaking tutor) is reachable at all.
     Recorded rather than asserted — a `false` is a finding, not a broken test.
   - **Which stock voices does the account actually have?** The legacy defaults
     are documented to expire 2026-12-31 and may not exist for accounts created
     after March 2026. Personas are database rows pointing at real provider
     voice ids (AC 1); they cannot be chosen from a list nobody has looked at.

   This is M4's §9.2 pattern applied again, and it earned its place there: four
   of five measurements changed the design. Retro lesson 18 is the other half —
   an ADR's claims about a vendor are hypotheses, and three of M3's were false.

   **Also carried into M5, from M4:** AC 15's reduced-motion preference is
   reinstated in the SAME change that adds the first real animation (see the
   AC 15 note above), and ADR-0015 (`Proposed`) becomes live the moment
   `NarrationAsset` lands in a migration. M5's spec asks the architect for three
   ADRs: the vendor choice and persona-to-voice indirection, the cache key and
   where audio lives, and our own normalised cue format — the last because the
   vendor's alignment is character-level, so grouping characters into words is
   our problem, not theirs.

   Plan §8 also flags that **the §312.4 direct notice must be edited before
   M5 ships**: M5 is the first outbound flow to a SECOND AI vendor, and the
   notice enumerates who receives a child's data.

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

- **The lesson stage's layout clamp bounds the BORDER box** while
  `overflow-hidden` clips the PADDING box, so a 1px sliver of the overflow it
  fixes remains (more at the rounded corners). `container.clientWidth` /
  `clientLeft` is the fix; it was left because it couples the jsdom harness to
  four more layout properties for one pixel.
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
[docs/retros/m0-m5.md](docs/retros/m0-m5.md) before running the pipeline —
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
- **`AUTH_SECRET` must be set or nothing authenticates.** It is commented out in
  `.env` as shipped; Auth.js fails config assertion before reading a cookie, so
  every request is anonymous and every probe returns 401 whatever it carries.
  The guard hook blocks agents from writing `.env` — a human sets it once. The
  symptom is `[auth][error] MissingSecret` in the dev server log, and nowhere
  else.

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

### Dispatching a review

**Scope a review by an explicit file list, not by "the milestone".** M4's review
was first sent as one `code-reviewer` and one `security-reviewer` over 73 files
and ~7,500 lines. The code reviewer spent its entire 60-turn budget reading and
reported **nothing at all** — 158k tokens, 71 tool calls, zero findings. Split
into four briefs with named files, a priority order, and "begin writing your
report by turn 35 no matter what", the same work returned thirteen findings
including four blockers, each reproduced with a throwaway probe.

The agents were not the constraint. The brief was.

- Above roughly fifteen files, split by concern — routes and gates, the
  pipeline, the data layer, the UI — and run them in parallel.
- Tell each reviewer what this project has ACTUALLY got wrong before (the
  repeat offenders in this file), not a generic checklist.
- Tell each what is already known, so findings are not re-reported.
- Require a reporting budget and an explicit list of what it did not reach.
- Reviewers carry `memory: project`. In M4 one was killed mid-run and its
  finding survived in `.claude/agent-memory/security-reviewer/`, which is the
  only reason the retention gap was found — check there after any review that
  ends abruptly.

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

**Agent memory splits by working directory, and that bit us.** The canonical
store is `/workspaces/Agents/.claude/agent-memory/` and it is version-
controlled. But M4's reviewers ran with their cwd inside `app/` and wrote to a
second store at `app/.claude/agent-memory/` — which those agents would never
have found again from the repo root, so five genuinely useful memories (the SDK
`parse` behaviour, the mutate-and-stub review technique, the live-constraint
check) were one commit away from being written where nothing reads them. Same
shape as the `.claude/agents/` subdirectory trap above. They have been merged
into the root store; **after any agent run, check for a stray
`app/.claude/agent-memory/` and consolidate it.**

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
