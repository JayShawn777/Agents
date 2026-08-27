# ADR-0013: Chat streams as NDJSON from a route handler, and a turn is idempotent on a client-supplied key

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m3-chat-tutor.md

## Revision 2026-08-28 — a partial turn is REGENERATED, not resumed, and `apiStream` does not throw

Revised in place under docs rule 3 (a **Proposed** ADR may be revised with a
dated note saying what changed and why). Written while building the route, from
two things that only surface once the code exists.

### §3's "resumes streaming into the same row" is not implementable

**What changed.** §3 says a retry whose assistant message is still `partial`
"replays what exists and resumes streaming into the same row". It cannot resume.
Resuming a half-written assistant message means prefilling the assistant turn,
and **assistant prefill returns a 400 on Claude Opus 5** and on every model in
the 4.6+ family. There is no supported way to ask the model to continue its own
truncated reply.

**What the code does instead**, in `lib/chat/turn.ts`:

| State of the assistant row on a `clientTurnId` collision | Action |
|---|---|
| not `partial` (complete) | **replay** — one `delta` with the stored text, then `done`. No AI call, no bill. §3's cost argument, unchanged. |
| `partial`, younger than `CHAT_IDLE_TIMEOUT_MS` | **replay** — presumed in flight. |
| `partial`, older than `CHAT_IDLE_TIMEOUT_MS` | **regenerate** from the top into the same row, replacing the fragment. |

**Why the age split.** Without it, two concurrent requests carrying one
`clientTurnId` both find a fresh empty partial and both start generating into
the same row — two generations for one turn, which is precisely what §3's own
verification test forbids. The budget is the same one the GET endpoint uses for
staleness, so a turn cannot be retryable by one surface and in-flight by the
other.

**What this does not change.** Every guarantee §3 actually makes survives: one
user row, one assistant row, one turn, `clientTurnId` unique, and no duplicate
on reconnect. The student ends up with a whole reply rather than a fragment with
a seam in the middle. A regenerate does **not** increment `studentTurnCount` — a
dropped connection must not cost a child one of their twenty turns.

### §6's `apiStream` yields a terminal error event rather than throwing

**What changed.** §6 types `apiStream` as throwing `ApiError` on a non-2xx. It
does not throw. A pre-stream failure is yielded as the same terminal
`{ type: 'error' }` event the stream itself uses.

**Why.** This is §2's own instruction to the caller — "the client treats an
`error` event exactly as it treats a non-2xx response" — carried into the
signature instead of left to the caller to remember. Throwing would give the app
two ways to report one failure and would make this the only place a network
error crosses a component boundary as an exception, which `apiFetch` exists
specifically to prevent.

### `CHAT_EFFORT` is new, and it is the lever the follow-up should measure

`output_config.effort` is `low` for chat, unlike `EXTRACTION_EFFORT`'s `high`.
On Opus 5 effort governs thinking depth, and thinking happens **before the first
text delta** — so a high setting spends AC 2's entire three-second first-token
budget before a single character reaches the child. Thinking itself stays on
(adaptive, the model default): disabling it is the documented way to leak
`<thinking>` tags into a reply, and the reply here is read by a nine-year-old.

The measurement this ADR's follow-up already demands should now also fix
`CHAT_EFFORT`, because it is the constant that actually moves the number.

## Context

M3 needs a transport, and the acceptance criteria are unusually specific about
the failure modes rather than the happy path:

- **AC 2** — assistant text is delivered **incrementally**, not as one response at
  the end, and the first content chunk arrives inside a configured budget.
- **AC 12** — when the student closes the tab mid-stream and the server detects
  the abort, generation is **cancelled**, and **either** the partial text is
  persisted and marked partial **or** nothing is persisted — *"one of the two,
  consistently, never a duplicate turn on reconnect."*
- **AC 13** — hitting the output token cap must tell the client the reply was cut
  short rather than ending mid-sentence.
- **AC 18** — a refusal or upstream error shows a plain message and a retry, with
  no stack trace, model id or provider payload reaching the browser.
- **AC 19** — a stream that stalls past an idle timeout is terminated, the UI
  leaves the typing state, and the turn is recoverable by retrying.
- **AC 11** — both messages persisted with role, content, timestamp and token
  counts, in order.

ADR-0006 fixed the surrounding contract: every mutation is a route handler,
wrapped by `withAuth()`, returning `ApiResult<T>` with an explicit status. A
streaming reply is the first thing in this codebase that does not fit that
envelope, and how it does not fit needs to be written down rather than discovered
by two engineers separately.

`docs/research/anthropic-api.md` §4 gives the SDK shape: `client.messages.stream()`
yields `content_block_delta` events; `stream.finalMessage()` is the supported way
to get the completed message rather than hand-rolling a promise around `.on()`.
Streaming is required above ~16K `max_tokens` to avoid HTTP timeouts.
`docs/research/elevenlabs-tts.md` §7 confirms Vercel supports streaming from Node
serverless functions and that Next route handlers can return a `ReadableStream`
directly — and that **streaming time counts toward `maxDuration`**.

The retry story is the part that is easy to get wrong. AC 19 says a stalled turn
is "recoverable by retrying", and AC 12 says a reconnect must never produce a
duplicate turn. Those two sentences together mean the client will re-send a
message we may already have persisted, and the server has to be able to tell.

## Decision

We will return a **newline-delimited JSON stream from a normal route handler**,
hand-rolled over the Anthropic SDK's own stream, and we will make a turn
**idempotent on a client-supplied `clientTurnId`** enforced by a unique index.

### 1. The transport

`POST /api/chat/sessions/[sessionId]/messages` returns
`Content-Type: application/x-ndjson`, `Cache-Control: no-store`,
`X-Accel-Buffering: no`, with `export const maxDuration = 300`.

The body is one JSON object per line:

```ts
export type ChatStreamEvent =
  | { type: 'turn';  userMessage: ChatMessageDTO; assistantMessageId: string }
  | { type: 'delta'; text: string }
  | { type: 'done';  message: ChatMessageDTO; session: ChatSessionDTO }
  | { type: 'error'; code: ErrorCode; message: string };
```

NDJSON rather than SSE's `text/event-stream`: we get no benefit from
`EventSource` (which cannot POST, cannot send headers, and would force the turn
into a GET), and NDJSON is `line.split('\n')` plus `JSON.parse` on the client
instead of an SSE frame parser.

### 2. Where the `ApiResult` envelope stops, stated as a contract rule

**Every failure before the first byte of the stream is a normal `ApiResult`
error response with a real status code**, produced by `withAuth()`: 401, 403
(non-`ACTIVE`), 404, 409 (session not `OPEN`), 400 (zod), 429 (hourly cap). All
six of M3's status-bearing criteria are therefore asserted exactly as every other
route's are, by calling the handler directly in Vitest.

**Once the stream has opened the status is already 200 and cannot change.** A
failure after that point is a terminal `{ type: 'error' }` event carrying an
allowlisted message from `lib/errors.ts` — never an exception message, never a
model id (AC 18). The client treats an `error` event exactly as it treats a
non-2xx response.

This is the only place in the app where a success body is not
`{ ok: true, data }`. It is documented here so it is a decision rather than an
inconsistency.

### 3. Idempotency: `clientTurnId`

The request body is `{ clientTurnId: z.uuid(), content: z.string().trim().min(1)
.max(CHAT_MESSAGE_MAX_LENGTH) }`, `.strict()`.

```prisma
model ChatMessage {
  clientTurnId String?   // set on USER messages, null on ASSISTANT
  @@unique([sessionId, clientTurnId])
  @@unique([sessionId, sequence])
}
```

Postgres treats NULLs as distinct in a unique index, so many assistant messages
with a null `clientTurnId` coexist without a partial index.

The handler's first action, before any AI call, is one transaction that:

1. increments `studentTurnCount` and allocates the next two `sequence` values;
2. inserts the **user** message with `clientTurnId`;
3. inserts an **empty assistant** message with `partial: true`.

A retry carrying the same `clientTurnId` hits P2002 on step 2. The handler
catches it (the same pattern `lib/uploads/record-upload.ts` already uses for
`Upload.pathname`), re-reads the existing pair, and:

- if the assistant message is complete, replays it as a single `delta` plus
  `done` — the student sees the reply they missed, and **no second generation is
  billed**;
- if it is still `partial`, replays what exists and resumes streaming into the
  same row.

Either way there is exactly one turn. AC 12's "never a duplicate turn on
reconnect" is a unique index, not a convention.

A client-supplied id is acceptable here because it is not a security boundary —
the session is already owner-scoped by `withAuth()` step 3, so the worst a
crafted id achieves is colliding with the caller's own turn.

### 4. Abort: persist the partial, always

AC 12 offers a choice; we take **persist-and-mark-partial**, consistently.

The assistant row already exists (§3), so there is nothing to create on abort —
only content to write. The handler accumulates deltas as it forwards them and
registers `req.signal`'s `abort` listener:

```
on abort:
  anthropicStream.abort()               // cancel generation; stop billing output
  after(() => persist(accumulated, { partial: true }))
```

`after()` from `next/server` — the same mechanism ADR-0005 uses to schedule
extraction — so the write survives the response being torn down.

We choose persist-and-mark over persist-nothing because a partial reply is
readable, because M7 reads transcripts and a hole in one is worse than a marked
fragment, and because a parent reading a transcript (AC 14) should see what their
child actually saw.

### 5. Truncation and idle timeout

**AC 13.** After `stream.finalMessage()`, `stop_reason === 'max_tokens'` sets
`ChatMessage.truncated` and the `done` event carries it. The UI renders "that
reply was cut short" plus a continue affordance. `CHAT_MAX_OUTPUT_TOKENS` is
config, not a literal.

**AC 19.** A timer resets on every forwarded delta. If `CHAT_IDLE_TIMEOUT_MS`
elapses with no delta, the handler aborts the Anthropic stream, emits
`{ type: 'error', code: 'UPSTREAM_ERROR' }`, closes the stream, and persists what
it has as partial. The client leaves the typing state on either an `error` or a
`done`, never on stream end alone — a socket that dies with no terminal event is
treated as an idle timeout client-side after the same budget.

**AC 18.** `stop_reason === 'refusal'` and typed SDK error classes are checked
most-specific-first, exactly as `lib/extraction/run-extraction.ts` does, and
mapped through a `CHAT_FAILURE_MESSAGES` allowlist in `lib/errors.ts`. Nothing
string-matches an error message.

### 6. Client side

`lib/api/client.ts` gains one primitive beside `apiFetch<T>()`:

```ts
export async function* apiStream<E>(
  url: string, init: RequestInit
): AsyncGenerator<E>;   // yields parsed lines; throws ApiError on a non-2xx
```

It buffers partial lines across chunk boundaries — a `delta` **will** be split
mid-JSON eventually, and a naive `split('\n')` per chunk works in development and
breaks in production. `AbortController` is wired to component unmount, which is
what produces the server-side abort in §4.

## Alternatives considered

### The Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) with `useChat`
- **Pros:** This is the problem it was built for. `streamText` + `useChat` gives
  incremental rendering, abort, retry, tool calls and a message store for
  essentially no code. Well-maintained, first-party for our deployment target,
  and it would make M3's UI a fraction of the size.
- **Cons:** A new major dependency (two packages, and `useChat` pulls a client
  runtime), which needs the owner's approval and which we would be adopting for
  one surface. More substantially: it interposes its own message and provider
  abstraction between us and `client.messages.stream()`, and the three things M3
  is actually strict about all live in that gap — `usage.cache_read_input_tokens`
  (AC 8), the exact `stop_reason` (AC 13, AC 18), and abort-time partial
  persistence with our own idempotency key (AC 12). Its persistence hooks fire on
  completion, which is the case we are *not* worried about. We would spend the
  saved code re-establishing access to the details we need.
- **Rejected because:** the criteria are about the failure modes, and the failure
  modes are what an abstraction smooths over. Named as the revisit trigger if
  chat grows beyond one surface — this is the alternative most likely to be right
  later.

### Server-Sent Events (`text/event-stream`) with `EventSource`
- **Pros:** A real standard with automatic browser reconnection and a
  `Last-Event-ID` header purpose-built for resumption.
- **Cons:** `EventSource` is GET-only and cannot carry headers or a body, so the
  student's message would have to go in a query string — a child's free text in a
  URL, which lands in every access log we and Vercel keep. Working around that
  means POST-then-GET with a server-side buffer, which is a queue. And
  `EventSource`'s automatic reconnect is a *liability* here: it re-issues the GET
  on any disconnect, which is precisely how a duplicate turn happens.
- **Rejected because:** GET-only puts a minor's free text in a URL, and free
  reconnection is the thing AC 12 warns about.

### SSE framing over `fetch` (the format without `EventSource`)
- **Pros:** The wire format `messages.stream()` already speaks; familiar; a
  future `EventSource` migration is free.
- **Cons:** We would write an SSE frame parser (`event:`/`data:`/`id:`/blank-line
  framing, multi-line data, comment lines) to carry JSON objects one per message.
  NDJSON is the same capability with `JSON.parse` instead of a parser.
- **Rejected because:** it is strictly more parsing for no capability we use. This
  is a close call and either would work; NDJSON is chosen for the smaller client.

### WebSockets
- **Pros:** True bidirectional; trivial cancellation; no HTTP duration limit.
- **Cons:** Vercel serverless functions do not hold WebSocket connections, so
  this means a third-party realtime vendor — a new dependency, a new bill, a new
  name in the §312.4 direct notice (M0 AC 13), a new vendor assessment row (M0
  AC 52), and a new place a child's free text travels. All for a strictly
  one-directional stream.
- **Rejected because:** the compliance cost alone dwarfs the benefit, and the
  channel is one-way.

### No streaming: generate the whole reply, return one JSON response
- **Pros:** Fits ADR-0006's envelope exactly. No abort semantics, no partials,
  no idempotency key, no client parser. Every AC that names a status is asserted
  the ordinary way.
- **Cons:** AC 2 requires incremental delivery in terms, and the user story is
  explicit about not staring at a spinner. A tutoring reply with adaptive thinking
  on Opus 5 is measured in tens of seconds; a child will assume it is broken.
- **Rejected because:** AC 2 forbids it.

### Poll a background job, as extraction and practice generation do
- **Pros:** Uniform with the rest of the codebase. Survives any function duration
  limit. The status machine already exists in two other milestones.
- **Cons:** Polling delivers the reply in chunks of the poll interval, so it is
  incremental in the same sense a flip-book is a film. It also doubles the
  database traffic per turn.
- **Rejected because:** AC 2's "as it is generated" is about perceived
  responsiveness, and a 2-second poll is not it. Kept as the **fallback if the
  measured streaming duration does not fit inside `maxDuration`** — M3's open
  question — because the message rows and the session machine are already shaped
  for it.

## Consequences

### Positive
- No new dependency. The Anthropic SDK is already approved and already used.
- Every status-bearing criterion is still asserted by calling the handler
  directly in Vitest, because every pre-stream failure is still an `ApiResult`.
- AC 12 is a unique index. It cannot be regressed by a refactor, and the P2002
  catch is a pattern already in this codebase.
- Abort actually stops generation, so a closed tab stops costing output tokens.
- `cache_read_input_tokens` is right there on `stream.finalMessage()` and is
  persisted per message from day one, which is what makes ADR-0012's cost model
  observable rather than assumed.
- The retry path replays a completed turn instead of regenerating it, so AC 19's
  "recoverable by retrying" does not double-bill a flaky connection.

### Negative / accepted trade-offs
- **We own a stream parser on the client.** Small, but the partial-line buffering
  is the kind of bug that passes locally and fails on a slow network. It gets its
  own unit test with chunk boundaries placed inside a JSON object on purpose.
- **The one documented exception to the `ApiResult` envelope.** Two shapes to
  handle in `lib/api/client.ts` instead of one, and a rule a future engineer can
  misapply to a non-streaming route.
- **Streaming time counts toward `maxDuration`,** so a long reply and a slow model
  can still hit the ceiling. `maxDuration = 300` and `CHAT_MAX_OUTPUT_TOKENS` are
  the bounds, and the measurement M3's open question demands is what sets them.
- **`after()` on abort is best-effort.** If the function is torn down hard, the
  partial is lost and the row stays empty-and-partial. The `GET` endpoint treats
  an empty partial assistant message older than the idle budget as retryable, so
  the student is not stuck — but the transcript has a stub in it.
- **A partial reply is persisted and a parent may read it.** Deliberate (§4), and
  it must be visually marked as incomplete in the transcript, not silently
  rendered as the tutor's considered answer.
- Two rows are written before the model is called, so a request that fails
  immediately still leaves a turn in the transcript. Marked partial with empty
  content and retryable; the alternative — writing rows only on success — is what
  makes duplicates possible.

### Follow-up required
- [~] **Measure a real streaming turn end to end.** Done locally 2026-08-28
      (`tests/unit/live/chat.live.test.ts`, three real turns): first token
      **2072 / 1732 / 1749 ms**, whole turn **2183 / 2198 / 2887 ms**, output
      **87 / 105 / 99** tokens. All three constants are now measured rather than
      guessed and their doc comments say so. **Still outstanding: the same
      measurement from a DEPLOYED PREVIEW FUNCTION** — this was taken from a
      development machine, and the network path to Anthropic differs even though
      the model time will not.
      One thing it settles decisively: a ~3-second turn against
      `maxDuration = 300` means the polling fallback in "Alternatives
      considered" is not needed, and M3's open question "does the streaming call
      fit inside the function duration limit" is answered with two orders of
      magnitude to spare.
- [ ] Unit-test `apiStream` with chunk boundaries deliberately placed mid-JSON and
      mid-line.
- [ ] A Vitest test that fires the same `clientTurnId` twice concurrently and
      asserts one user row, one assistant row, and one generation.
- [ ] A Playwright test that aborts mid-stream and reloads, asserting exactly one
      turn and a `partial` marker.
- [ ] Confirm Vercel does not buffer `application/x-ndjson` responses on the
      target plan. `X-Accel-Buffering: no` is set defensively; it is unverified.

## Revisit when

Measured streaming duration does not fit inside `maxDuration` (the polling
fallback above becomes the design); or a second streaming surface appears —
narrated chat, a streamed lesson, a tool-using tutor — at which point the AI SDK
stops being a dependency for one screen and starts being infrastructure, and this
ADR should be superseded rather than extended.
