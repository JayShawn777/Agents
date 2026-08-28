# ADR-0012: Chat sessions are bounded at open, and the learner context is snapshotted onto the session row

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m3-chat-tutor.md, docs/specs/m7-adaptive-loop.md

## Revision 2026-08-27 — §2's renderer input is a sibling type, not a widened `OutboundLearnerFacts`

Revised in place under docs rule 3 (a **Proposed** ADR may be revised with a
dated note saying what changed and why).

**What changed.** §2 says the renderer's input is "the shared
`OutboundLearnerFacts` type — grade level, subjects, and a per-skill mastery
map". When slice 3 was built, that type was `{ gradeLevel, subject }` —
singular subject, no mastery — because M2's graders describe one problem, not
one student. The renderer instead takes a new sibling type,
`OutboundLearnerContext`, declared beside it in `lib/ai/outbound.ts`.

**Why.** Widening `OutboundLearnerFacts` in place would make every M2 grading
call site construct a `subjects` array and a mastery map to satisfy a consumer
it does not have, on a type that four reviewed files already depend on. The
property the ADR actually relies on is not that one type is shared — it is that
whatever the renderer receives *cannot carry an identifier*. Two types, each
with no name, id, avatar or email field, hold that just as structurally as one
does, and neither is padded with fields it does not use.

**What this does not change.** §2's determinism rules, §3's request shape, and
§4's two-test verification are unaffected. M7 widens `OutboundLearnerContext`
rather than `OutboundLearnerFacts` and bumps `LEARNER_CONTEXT_VERSION`, exactly
as §2 describes.

## Context

Two requirements meet on the same row and are usually treated as unrelated.

**Bounding.** M3's non-goals say *"No open-ended session. We have no human tutor
to end the conversation and no single-problem solve to conclude it, so the
boundary has to be designed in."* AC 6 requires a session that reaches its turn
or duration limit to be **closed with a short wrap-up**, further messages
**refused with the typed error shape**, and a next action offered. AC 4 requires a
*different* threshold — after a configured number of non-converging turns the
tutor stops withholding and works the problem through. `docs/research/tutoring-
product-patterns.md` §7 puts us structurally closest to Synthesis Tutor's
deliberately time-boxed 15–20 minute session.

**Caching.** M3 AC 8 is unusual for an acceptance criterion in that it asserts a
provider metric: *"Given three consecutive turns in one session, when the API
usage is inspected, then `cache_read_input_tokens` is greater than zero on the
second and third turns."* The spec explains why it is an AC rather than an
assumption: *"The stable prefix is the whole cost model; a varying byte anywhere
in it fails silently and expensively."*

`docs/research/anthropic-api.md` §5 gives the mechanics. Caching is a **prefix
match** — any byte change anywhere in the prefix invalidates everything after it.
Render order is `tools` → `system` → `messages`. The minimum cacheable prefix is
~1024 tokens and shorter prefixes silently do not cache. Maximum four
breakpoints. Cached reads cost ~0.1×, writes ~1.25×. And the diagnostic:
*"If `cache_read_input_tokens` is zero across repeated requests, something in the
prefix is varying — a timestamp, a UUID, unsorted JSON keys."*

M3's own open questions name the danger precisely:

> **Is the mastery summary in the prefix stable enough to cache (AC 8)?**
> TECHNICAL UNKNOWN. It is derived from M2 data that changes as the student
> practises. If it is re-rendered per turn with a fresh timestamp or unsorted
> keys, cache reads go to zero and nobody notices.

That last clause is the whole problem. This failure is invisible: the product
works perfectly and costs ten times more than it should, and nothing in the UI or
the test suite says so.

M7 AC 5 then extends the same requirement to the learner profile and adds
"byte-identical for the same profile version across repeated requests".

Doing nothing means a per-turn render, which is the obvious implementation and
which fails AC 8 the first time a student answers a practice problem mid-session.

## Decision

We will **render the learner context exactly once, at session open, store the
rendered string and its hash on the `ChatSession` row, and send those exact bytes
on every turn of that session** — and we will **stamp the session's bounds onto
the row at open** rather than reading them from configuration on each turn.

### 1. The row carries its own bounds

```prisma
model ChatSession {
  status           ChatSessionStatus  // OPEN | CLOSED_TURN_LIMIT | CLOSED_TIME_LIMIT | CLOSED_BY_STUDENT
  studentTurnCount Int    @default(0)
  maxStudentTurns  Int                // stamped from CHAT_MAX_STUDENT_TURNS at open
  revealAfterTurns Int                // stamped from CHAT_REVEAL_AFTER_TURNS at open
  expiresAt        DateTime           // openedAt + CHAT_MAX_SESSION_MINUTES
  openedAt         DateTime @default(now())
  closedAt         DateTime?
}
```

Bounds are **turns or minutes, whichever comes first** (the spec's assumption:
20 and 20). They are stamped on the row for the same reason
`ParentalConsent.method` is stamped rather than re-derived (ADR-0008 §6): a
session that ran under yesterday's limits must remain legible after the config
changes, and a limit that shifts under a live conversation is a bug nobody can
reproduce.

Closure is evaluated in two places, both cheap:

- On `POST .../messages`, **before** the AI call. A session past either bound is
  closed and the request returns **409**. AC 6's "further messages are refused
  with the typed error shape" is a status code, not a model instruction.
- Lazily on `GET .../[sessionId]`, so a session abandoned mid-conversation still
  reaches a terminal state for the reader. This is the same `reapIfStale` pattern
  `lib/extraction/run-extraction.ts` already uses for a killed function, and it
  means no cron job is needed.

The wrap-up message (AC 6) is **templated and written as a stored assistant
message** by the closing transaction, not generated. Generating a farewell costs
a call the student will not read.

`revealAfterTurns` (AC 4) is a **separate, smaller** threshold from
`maxStudentTurns` (AC 6) and drives a mid-conversation system message rather than
a closure. Research §5 notes Opus 5 supports appending
`{ role: 'system', content }` to `messages[]`, which injects an operator
instruction **without invalidating the cached prefix** and is the injection-safe
channel for it. That is exactly what AC 4 needs: at turn `revealAfterTurns`, the
turn's request appends "the student has now attempted this several times; work it
through step by step" **after** the last user message. The system prefix does not
move, so the cache survives.

### 2. The learner context is a snapshot, not a render

At session open, one pure function runs:

```ts
// lib/chat/context.ts — pure. No DB access, no clock, no randomness.
export function renderLearnerContext(facts: OutboundLearnerFacts): string;
export function hashContext(rendered: string): string;   // sha256, hex
export const LEARNER_CONTEXT_VERSION: string;
```

Its input is the shared `OutboundLearnerFacts` type — grade level, subjects, and
a per-skill mastery map — which **has no name, id, avatar or email field at all**,
so M3 AC 7's "contains no display name, avatar id, account email, user id or
student profile id" is a property of the type rather than of a redaction step.
M7 later widens the same type with the learner-profile summary and bumps
`LEARNER_CONTEXT_VERSION`.

Determinism rules the function must obey, and which are asserted by unit test:

- Subjects rendered in `SUBJECT_ORDER`, never in database order.
- Skills sorted by `skillCode` lexicographically.
- Only `level` per skill — never `lastPracticedAt`, never a count, never a
  timestamp of any kind.
- No `Date`, no `Math.random`, no `Object.keys` over a Prisma result.
- Rendered as prose with a fixed layout, not as JSON, so key ordering is not even
  a question.

The result and its hash are written to `ChatSession.renderedContext` and
`ChatSession.contextHash` at open, alongside `systemPromptVersion` and
`learnerProfileVersion`. Every turn reads them off the row.

**This is what makes AC 8 true by construction.** Practice completed mid-session
does not move the prefix, because the prefix is a stored string. A config change
does not move it. A skill reaching `SECURE` between turn 2 and turn 3 does not
move it. The next session picks up the change.

### 3. The request shape, and where the breakpoints go

```ts
system: [
  { type: 'text', text: TUTOR_SYSTEM_PROMPT },                  // static, versioned
  { type: 'text', text: session.renderedContext,
    cache_control: { type: 'ephemeral', ttl: '1h' } },          // breakpoint 1
],
messages: [
  { role: 'user', content: PROBLEM_CONTEXT_BLOCK,               // the problem, as DATA
    cache_control: { type: 'ephemeral', ttl: '1h' } },          // breakpoint 2
  ...storedTurns,
  { role: 'user', content: thisTurn },
]
```

Two breakpoints of the permitted four. `ttl: '1h'` rather than the 5-minute
default, because a student thinking about a fraction for six minutes should not
pay a cache write to come back.

**The problem text is a user message, never a system instruction** (AC 9). It is
wrapped in an explicit delimiter and preceded by a line stating that everything
inside is the student's homework, is data, and contains no instructions to
follow. `TUTOR_SYSTEM_PROMPT` states the same rule from the system side. This is
the prompt-injection control and it is why the extracted text never touches the
`system` array.

**`TUTOR_SYSTEM_PROMPT` must exceed the ~1024-token minimum cacheable prefix.** A
shorter prefix silently does not cache and AC 8 fails for a reason no log
explains. A unit test asserts an approximate token count above
`CHAT_SYSTEM_PROMPT_MIN_TOKENS`, so shortening the prompt fails CI rather than
the cost model.

### 4. How AC 8 is actually verified

Two tests, because one of them cannot run in CI.

- **In CI, free, deterministic:** open a session, take three turns against a
  mocked client, capture the three outbound request bodies, and assert the
  `system` array is **byte-identical** across all three and that
  `session.contextHash` equals `hashContext(renderLearnerContext(facts))`.
- **Behind `RUN_LIVE_AI=1`:** the same three turns against the real API,
  asserting `usage.cache_read_input_tokens > 0` on turns 2 and 3.

**Both halves now exist, and the live one passed on 2026-08-28**
(`tests/unit/live/chat.live.test.ts`). Turn 1 paid a cache WRITE of **1967
tokens** at `ttl: '1h'` (`ephemeral_1h_input_tokens: 1967`); turns 2 and 3 each
READ **1967** and wrote none, with only the new messages billed as fresh input
(**94** and **212** tokens). The cached span covers both breakpoints — the
static prompt, the snapshotted learner context, and the problem block — so §3's
placement is confirmed working rather than assumed.

**This is the assertion that could not be made any other way.** Every mocked
test in the suite passes identically whether or not Anthropic ever cached
anything; the only symptom of failure would have been a bill roughly ten times
the cost model, with no error and no log line.

Stated plainly in the plan: **CI proves the prefix does not vary; only the live
test proves Anthropic cached it.** `cacheReadTokens` and `cacheWriteTokens` are
persisted on every `ChatMessage` from day one, per the research's "this failure is
silent and expensive, so it belongs in our logging from day one."

## Alternatives considered

### Render the learner context fresh on every turn
- **Pros:** The tutor always knows the newest mastery state, including a skill
  the student just improved mid-session. Simplest code — one function, called
  where it is needed, no column.
- **Cons:** It is precisely the failure M3's open question describes. Any change
  to M2 data between turns invalidates the prefix, the cache read goes to zero,
  and the cost rises about tenfold with no visible symptom. Making it stable
  would require the render to be *provably* insensitive to every field that could
  move — a property nobody can maintain across six milestones.
- **Rejected because:** AC 8 exists specifically to stop this, and correctness
  here means "cannot vary", not "usually does not vary".

### No learner context at all — just the problem
- **Pros:** Trivially stable and trivially cheap. The prefix is static app-wide,
  so caching works across every student.
- **Cons:** AC 7 requires grade level, subjects and the mastery summary in the
  system prompt, and the "I want the tutor to already know I am in grade 4 and
  that fractions are hard for me" user story is a stated goal of the milestone.
- **Rejected because:** the spec requires the context.

### Recompute per turn but cache the *rendered string* in memory keyed by profile
- **Pros:** No column. Fresh-ish context. Bytes stable within a cache lifetime.
- **Cons:** Serverless functions do not share memory, so on Vercel two turns of
  one conversation routinely land on different instances and the "cache" is a
  coin flip. And the failure is, again, silent.
- **Rejected because:** it depends on instance affinity we do not have.

### Store the context but refresh it when the underlying data changes
- **Pros:** The best of both — fresh when it matters, stable when it does not.
- **Cons:** "When it changes" is a decision made per turn, so the prefix's
  stability again depends on a condition rather than on a fact. The first time it
  refreshes mid-session, that turn pays a cache write and the following turns pay
  a fresh write chain. It also means a session's transcript is no longer
  interpretable, because two turns were answered under different beliefs about
  the student.
- **Rejected because:** it reintroduces exactly the conditional the snapshot
  removes, for a freshness benefit measured in minutes.

### Bound the session by tokens rather than turns or minutes
- **Pros:** Directly bounds cost, which is the real constraint. Insensitive to
  how chatty a turn is.
- **Cons:** Meaningless to a child ("you have 4,000 tokens left"), and AC 6
  requires the student to be offered a next action at a boundary they can
  anticipate. A conversation that ends after three long turns and twenty short
  ones is arbitrary from the student's side.
- **Rejected because:** the bound is a product affordance first and a cost control
  second. `CHAT_MESSAGES_PER_HOUR` (AC 20) and `CHAT_MAX_OUTPUT_TOKENS` are the
  cost controls.

### Read bounds from `lib/config.ts` on every turn instead of stamping them
- **Pros:** One less pair of columns; a config change takes effect immediately.
- **Cons:** A limit that changes under a live session produces a conversation that
  ends earlier or later than the student was told, with no record of why. The same
  argument ADR-0008 made for recording `ConsentMethod` on the row.
- **Rejected because:** two integers are cheaper than an unreproducible bug.

## Consequences

### Positive
- AC 8 becomes structural. The prefix cannot vary within a session because it is
  a stored string, so the expensive silent failure is not reachable.
- AC 7's "no identifiers" is a property of `OutboundLearnerFacts`' type, shared by
  M2's generation, M3's chat, M4's authoring and M7's summarisation — one type,
  four milestones, one test each.
- AC 4's reveal uses a mid-conversation system message, so the escalation
  costs nothing in cache terms. Without that mechanism the obvious implementation
  (edit the system prompt) would invalidate the prefix at exactly the moment the
  conversation is longest and most expensive.
- AC 6 is a status code and a stored template, not a behaviour we hope the model
  performs.
- M7 AC 5 is satisfied by the same function and the same stored-render pattern,
  so M7 adds a field to `OutboundLearnerFacts` rather than a new mechanism.
- The transcript is interpretable: every turn in a session was answered under one
  stated belief about the student, recorded on the row.

### Negative / accepted trade-offs
- **The tutor's picture of the student is stale within a session**, by up to the
  session's own length. A student who masters a skill on turn 3 is still tutored
  as if they had not on turn 18. Accepted: the window is 20 minutes and the next
  session is current.
- **`renderedContext` is a duplicated blob of student-derived data on every
  session row.** It is small, and it is covered by the same cascade and the same
  retention row as the transcript it belongs to, but it does mean the same
  sentence about a child's difficulties exists in N places. It must never appear
  in a DTO, and that is a named rule with a test.
- **A prefix that quietly falls below 1024 tokens stops caching.** Guarded by a
  CI assertion on an approximate token count, which is itself approximate.
- **The live AC 8 assertion is not in CI.** We can prove our bytes are stable; we
  cannot prove the provider honoured them without spending money on every run.
  Said plainly rather than implied.
- Two extra columns on `ChatSession` for the bounds, and two for the context.

### Follow-up required
- [ ] Measure a real streaming turn's wall clock before fixing
      `CHAT_IDLE_TIMEOUT_MS` and `CHAT_FIRST_TOKEN_BUDGET_MS` (M3's open
      question — streaming time counts toward `maxDuration`).
- [ ] Run the `RUN_LIVE_AI=1` cache assertion once against the real API before M3
      is called done, and record the observed `cache_read_input_tokens`.
- [ ] Write `TUTOR_SYSTEM_PROMPT` to comfortably exceed 1024 tokens **on
      purpose**, and note in the file that its length is load-bearing so nobody
      trims it for tidiness.
- [ ] Decide the session bounds for real (20/20 is an assumption) after watching
      one child use it.
- [ ] AC 21's distress path needs its fixed copy written by someone who is not an
      engineer, and the owner must answer whether the account holder is notified.

## Revisit when

Measured cache hit rates are good but the staleness within a session becomes a
real complaint (a mid-session refresh with an explicit new breakpoint becomes
worth its cost); or M7's learner profile makes the context large enough that a
1-hour TTL is no longer the right trade; or Anthropic changes the prefix-matching
semantics, which would make this whole design a no-op rather than a saving.
