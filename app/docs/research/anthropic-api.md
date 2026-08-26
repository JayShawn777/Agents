# Research: Claude API — vision, PDF, structured output, streaming, caching

- **Date:** 2026-08-26
- **Researcher:** Claude (from the bundled `claude-api` reference skill, not from memory)
- **Question:** Can one Anthropic API surface handle all four AI jobs in the tutor app — reading uploaded schoolwork, generating practice, chat tutoring, and authoring whiteboard lesson scripts — and what does it cost?
- **Verdict:** Yes. A single `POST /v1/messages` surface covers all four, with native image *and* PDF input, schema-validated JSON output for lesson scripts, and streaming for chat. The catches are a 32 MB / 100-page ceiling on inline PDFs, and that lesson authoring is an expensive call we must cache aggressively.

## Summary

- **One model, four jobs.** Vision, generation, chat, and structured authoring are all the Messages API. No second vendor needed for any AI capability in the plan.
- **Use `claude-opus-5`** — 1M context, $5.00/MTok input, $25.00/MTok output. This is the project default; do not silently downgrade for cost.
- **Images and PDFs are first-class inputs.** Photos of worksheets go in as `image` blocks; PDFs as `document` blocks. No OCR library required.
- **Inline PDF limits: 32 MB per request, 600 pages** (100 pages on 200K-context models). Above that, use the Files API.
- **The Files API is the right fit for us** — upload once, reference by `file_id` across many calls. 500 MB max file, 100 GB per org, uploads are free; you pay only for tokens when the file is used in a message.
- **`LessonScript` maps directly onto structured outputs.** `client.messages.parse()` with `zodOutputFormat(schema)` returns a validated object — the same zod schema the API boundary already requires.
- **Prompt caching is the cost lever.** The learner profile + tutoring system prompt is a large, stable prefix reused on every turn. Cached reads are ~0.1x cost.
- **Thinking is on by default on Opus 5** and is worth keeping for math grading. Control spend with `output_config.effort`, not by disabling it.
- **Streaming is required** for long outputs — the SDK needs it above ~16K `max_tokens` to avoid HTTP timeouts.

## Findings

### 1. Model selection and pricing

| Model | ID | Context | Input $/MTok | Output $/MTok |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | 1M | $5.00 | $25.00 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $2.00 | $10.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1.00 | $5.00 |

Use `claude-opus-5` as the default across the app. Model IDs are complete as
written — **never append a date suffix** (`claude-opus-5-20260101` is not a
valid ID). If cost forces a cheaper tier on a specific mechanical route later,
that is an explicit decision worth an ADR, not a quiet substitution.

### 2. Reading uploaded schoolwork

**Photo of a worksheet** — an `image` block, base64 or URL, placed *before* the
text block:

```typescript
const response = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 16000,
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
      { type: "text", text: "Extract every problem on this worksheet." },
    ],
  }],
});
```

**PDF** — a `document` block. No beta header for the inline base64 form:

```typescript
{ type: "document",
  source: { type: "base64", media_type: "application/pdf", data: b64 } }
```

The base64 string must contain **no newlines**. Limits: **32 MB per request**
and **600 pages** (100 pages on 200K-context models). A phone photo will never
approach this; a scanned textbook chapter will.

**Files API (beta `files-api-2025-04-14`)** — upload once, reference many times.
This is what we want, because a single upload gets read repeatedly: once to
extract problems, again to generate similar practice, again when the student
asks about it in chat.

```typescript
const uploaded = await client.beta.files.upload({
  file: await toFile(stream, undefined, { type: "application/pdf" }),
  betas: ["files-api-2025-04-14"],
});
// then reference it:
{ type: "document", source: { type: "file", file_id: uploaded.id } }
```

The beta header is required on **both** the upload and every `messages.create`
that references the file. Max 500 MB per file, 100 GB per org. File operations
are free; you are billed for tokens only when the content is used in a message.

**Citations** (`citations: { enabled: true }` on a document block) make the model
point at the exact page or character range it drew from. Useful for "show me
where I went wrong". **Incompatible with `output_config.format`** — a request
using both returns 400. So: citations on the *chat* path, structured output on
the *authoring* path, never the same call.

### 3. Structured output — the `LessonScript` contract

This is the linchpin of the whiteboard design. The model must emit drawing steps
we can render, not prose. `messages.parse()` validates against a zod schema:

```typescript
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const LessonStep = z.object({
  narration: z.string(),
  draw: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("write"), latex: z.string(), at: z.object({ x: z.number(), y: z.number() }) }),
    z.object({ kind: z.literal("circle"), target: z.string() }),
    z.object({ kind: z.literal("arrow"), from: z.string(), to: z.string() }),
  ]),
});
const LessonScript = z.object({ title: z.string(), steps: z.array(LessonStep) });

const response = await client.messages.parse({
  model: "claude-opus-5",
  max_tokens: 16000,
  messages: [{ role: "user", content: prompt }],
  output_config: { format: zodOutputFormat(LessonScript) },
});
response.parsed_output; // typed — but NULL if parsing failed, so guard it
```

Two notes that matter:

- `parsed_output` is **null on parse failure**. Guard it; do not `!` it in
  production code the way the SDK docs' example does.
- Use `output_config: { format: ... }`. The older top-level `output_format`
  parameter is deprecated.

For tool-shaped calls instead, `strict: true` on the tool definition (a
top-level field on the tool, *not* on `tool_choice`) with
`additionalProperties: false` guarantees the input validates.

### 4. Streaming the chat tutor

```typescript
const stream = client.messages.stream({
  model: "claude-opus-5",
  max_tokens: 64000,
  messages,
});
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    // forward to the client
  }
}
const final = await stream.finalMessage();
```

`max_tokens` guidance: **~16000 non-streaming, ~64000 streaming.** Opus 5
supports up to 128K output tokens but the SDK requires streaming at that size.
Do not lowball it — hitting the cap truncates mid-thought and costs a retry.

Use `stream.finalMessage()` rather than hand-rolling a promise around `.on()`.

### 5. Prompt caching — where our money is saved

Caching is a **prefix match**: any byte change anywhere in the prefix
invalidates everything after it. Render order is `tools` → `system` → `messages`.

Our tutoring prompt has exactly the right shape for this: a large stable prefix
(tutoring instructions + the student's learner profile + their mastery summary)
followed by a short volatile suffix (this turn's question). Put `cache_control`
at the end of the stable part:

```typescript
system: [{ type: "text", text: tutorInstructions + learnerProfile,
           cache_control: { type: "ephemeral" } }],
```

- Minimum cacheable prefix is **~1024 tokens** — shorter prefixes silently do
  not cache.
- Max **4 breakpoints** per request.
- Default TTL 5 minutes; `{ type: "ephemeral", ttl: "1h" }` for an hour.
- Cached reads cost ~0.1x; cache writes ~1.25x.

**Verify it is working:** `response.usage.cache_read_input_tokens`. If that is
zero across repeated requests, something in the prefix is varying — a timestamp,
a UUID, unsorted JSON keys, or a reordered tool list. This failure is silent and
expensive, so it belongs in our logging from day one.

Related: Opus 5 supports **mid-conversation system messages** — append
`{ role: "system", content: "..." }` to `messages[]` instead of editing the
top-level `system` field. This injects an operator instruction *without*
invalidating the cached prefix, and is the injection-safe channel for it. It
must follow a user message and cannot be `messages[0]`.

### 6. Thinking and effort

Thinking is **on by default** on Opus 5 — omitting the `thinking` parameter runs
adaptive thinking. This is what we want for grading a student's algebra.

- `thinking: { type: "adaptive", display: "summarized" }` if we ever want to show
  reasoning. The default is `"omitted"` (thinking happens and is billed, but the
  text comes back empty) — which reads as a long pause in a streaming UI.
- Control cost with `output_config: { effort: "low" | "medium" | "high" | "xhigh" | "max" }`.
  Default is `high`. Use `low` for mechanical routes, `high`/`xhigh` for grading
  and lesson authoring.
- **`budget_tokens` is removed on Opus 5** — sending it returns 400. If you
  recall that pattern, it is stale.
- Do **not** disable thinking to save money — lower the effort instead.
  Disabled thinking on Opus 5 has two known failure modes, including silently
  writing a tool call into visible text where it never executes.

### 7. Refusals

Safety classifiers can decline a request: HTTP 200 with
`stop_reason: "refusal"` and a `stop_details` category. **Always check
`stop_reason` before reading `content`.** `stop_details` is populated *only* for
refusals and is `null` otherwise — guard before reading it.

For an app processing arbitrary uploaded schoolwork this is a real edge case
worth handling with a clean user-facing message rather than a stack trace.
Server-side fallbacks (`betas: ["server-side-fallback-2026-07-01"]` plus
`fallbacks: "default"`) re-run a declined request on a fallback model inside the
same call; worth enabling once we see whether it ever fires.

### 8. Gotchas that would otherwise bite us

- **No assistant prefill.** Prefilling the last assistant turn returns 400 on
  Opus 5. Use structured outputs or system instructions to shape the response.
- **Parse tool inputs with `JSON.parse()`**, never string-match the serialized
  input — escaping varies.
- **Use the SDK's own types** (`Anthropic.MessageParam`, `Anthropic.Message`,
  `Anthropic.Tool`) rather than defining parallel interfaces. Our TypeScript is
  strict; the SDK types are better than anything we would hand-write.
- **Typed error classes**, checked most-specific-first: `BadRequestError` →
  `AuthenticationError` → `RateLimitError` → `APIError`. Never string-match
  error messages.
- **TS client `timeout` is in milliseconds** (Python's is seconds). Default 10
  minutes, `maxRetries` default 2 — so worst-case wall clock is
  `timeout × (maxRetries + 1)`. This interacts with Vercel function duration
  limits and needs checking against the storage research.
- **ESM:** `__dirname` is undefined. Derive paths from `import.meta.url`.

### 9. Rough cost arithmetic

Computed from the listed rates above — not a quoted figure from Anthropic.

| Flow | Rough input | Rough output | Est. cost/call |
|---|---|---|---|
| Read one worksheet photo → structured problems | ~2K tok | ~2K tok | ~$0.06 |
| Generate 10 similar practice problems | ~3K tok | ~3K tok | ~$0.09 |
| One chat turn (cached profile prefix) | ~15K tok, mostly cached | ~1K tok | ~$0.03 |
| Author one whiteboard lesson | ~5K tok | ~8K tok | ~$0.23 |

Lesson authoring is the expensive call, and it is also the most cacheable
*output* — the same lesson for the same skill can be stored in Postgres and
replayed for other students. That storage decision should be an ADR.

## Risks and unknowns

- **Pricing above was cached in the reference skill as of 2026-06-24.** Re-verify
  at the live pricing page before anyone builds a business model on it.
- **Vercel function duration vs. lesson authoring latency is unverified.** A
  `max` effort authoring call with adaptive thinking may exceed a serverless
  function's execution limit. This needs a real measurement before M4, and may
  force lesson authoring into a background job rather than a request/response
  route. Flagging as the single biggest unvalidated assumption in the plan.
- **No `ANTHROPIC_API_KEY` entry exists in `.env.example` yet** — must be added
  when the first API route lands, and it is server-only. It must never be
  prefixed `NEXT_PUBLIC_`.
- **I did not verify** current rate limits or concurrency caps per tier — those
  are not in the bundled reference and need a live docs check before load
  testing.
- **PDF page limits interact with context window.** The 600-page figure applies
  to 1M-context models; the 100-page figure to 200K-context ones. Since we are on
  Opus 5 (1M), 600 applies — but confirm before promising textbook-scale uploads.
- **Structured output and citations are mutually exclusive.** If a future feature
  wants both cited *and* schema-validated output in one call, it needs two calls.

## Sources

- Bundled `claude-api` reference skill (`typescript/claude-api/README.md`, `tool-use.md`, `streaming.md`, `files-api.md`) — model table, vision/PDF blocks, structured outputs, caching, streaming, Files API. Cached 2026-06-24.
- https://docs.anthropic.com/en/docs/about-claude/pricing — live pricing; **not re-fetched for this document**, flagged above as needing verification.
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching — caching semantics.
- https://docs.anthropic.com/en/docs/build-with-claude/pdf-support — PDF limits.

---

**Note on staleness:** research goes out of date silently. Anything in here is
only true as of the Date above. Re-verify version numbers, pricing, and API
shapes before relying on them for a new decision.
