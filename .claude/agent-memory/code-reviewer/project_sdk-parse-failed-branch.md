---
name: sdk-parse-failed-branch
description: The Anthropic SDK's zodOutputFormat THROWS AnthropicError on schema failure — it never yields parsed_output === null — so every "null parse -> PARSE_FAILED" branch in this repo is dead for the case it names.
metadata:
  type: project
---

In `@anthropic-ai/sdk`, `messages.parse()` with `output_config.format: zodOutputFormat(S)`
does NOT set `parsed_output` to `null` when the model's JSON violates `S`. It **throws
`AnthropicError`** (`helpers/zod.mjs` -> `parse`, re-thrown by `lib/parser.mjs` ->
`parseOutputFormat`). `parsed_output === null` only happens when the response contains no
text block at all. Truncation at `max_tokens` also throws, not nulls.

Consequence for this codebase: any handler shaped like

    const out = response.parsed_output;
    if (out === null) return finalizeFailed(..., "PARSE_FAILED");

classifies real schema violations as `UPSTREAM` (or whatever `classifyFailure` maps
`AnthropicError` to), not `PARSE_FAILED`. Confirmed in M4 (`lib/lessons/author.ts`);
the same shape exists in `lib/extraction/run-extraction.ts`, `lib/practice/generate.ts`
and `lib/checkpoints/generate.ts` and was not re-checked.

**Why:** Found during the M4 authoring review (2026-08-28). Unit tests never catch it
because they mock `messages.parse` to *resolve* `{ parsed_output: null }` — a state
production does not produce for that reason. This is retro lesson 17 in a new costume.

**How to apply:** When reviewing any AI-calling path, do not trust a `parsed_output ===
null` branch. Reproduce it: call the real `zodOutputFormat(Schema).parse(badJson)` inside
the mock instead of hand-returning `null`, then assert the failure code. See
[[review-probe-technique]].
