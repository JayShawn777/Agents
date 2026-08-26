# ADR-0005: Extracted problems are a zod-validated structured output storing LaTeX

- **Status:** Proposed
- **Date:** 2026-08-26
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m1-upload-and-extract.md

## Context

M1's whole purpose is turning a photograph of a worksheet into rows the rest of
the product can build on. The acceptance criteria pin the contract unusually
tightly:

- AC 19 — a fixture page with five problems yields **exactly five** rows, each
  with a stable ordinal matching its position, problem text, a subject, a
  problem type, and a confidence between 0 and 1.
- AC 20 — every extracted problem **corresponds to a problem physically on the
  page**. Nothing generated, completed, extended or invented. Generation is M2.
- AC 21 — mathematical notation is **preserved in a form that renders back to
  the same expression**, not flattened into ambiguous plain text.
- AC 22 — the student's handwritten answer, if captured, lives in a **separate
  field** and is never presented as part of the problem.
- AC 23 — if the structured parse returns null, the extraction is `FAILED` and
  **zero rows** are written. No partial persistence.
- AC 24 — on `stop_reason: 'refusal'`, `FAILED` plus a plain message, and **no
  stack trace, model identifier, raw provider payload or internal error text
  reaches the browser**.
- AC 25 — a pet photo yields `COMPLETE_EMPTY`, zero problems, no invented
  problem, no crash.
- AC 26 — low-confidence problems are visually flagged.
- AC 29 — after a delete, remaining ordinals stay **stable and non-colliding**.

`docs/research/anthropic-api.md` §3 establishes the mechanism: `messages.parse()`
with `zodOutputFormat(schema)` under `output_config: { format }`, and warns that
`parsed_output` is **null on parse failure** and must be guarded rather than
`!`-asserted. §2 notes structured output and citations are mutually exclusive,
so M1 uses structured output and M3 will use citations in a different call.

## Decision

We will define **one zod schema that is simultaneously the model's output
format, the API boundary validator, and the source of the TypeScript types**,
and we will store mathematics as **LaTeX inside the problem text**, rendered
server-side with KaTeX.

**`lib/ai/extraction-schema.ts`** — the single contract:

```ts
export const ExtractedProblemSchema = z.object({
  ordinal:           z.number().int().min(1).max(200),
  label:             z.string().max(16).nullable(),      // "4", "4a", "Question 3"
  text:              z.string().min(1).max(2000),        // LaTeX in $…$ / $$…$$
  containsMath:      z.boolean(),
  subject:           z.enum(SUBJECT_VALUES),
  problemType:       z.string().min(1).max(64),          // free text, coarse
  studentAnswerText: z.string().max(2000).nullable(),    // AC 22
  confidence:        z.number().min(0).max(1),
});

export const ExtractionResultSchema = z.object({
  containsSchoolwork: z.boolean(),                       // AC 25
  problems:           z.array(ExtractedProblemSchema).max(100),
});
```

Deliberate properties of this shape:

- **`ordinal` is the model's report of position on the page and is never
  renumbered.** After a delete of #3 of 5, the surviving ordinals are 1, 2, 4, 5.
  That is what AC 29's "stable, non-colliding" means, and it is enforced by
  `@@unique([extractionId, ordinal])`. Display uses `label` when present and the
  list index otherwise, so the student never sees a gap.
- **`studentAnswerText` is nullable and structurally separate** (AC 22). Nothing
  in M1 reads it. It exists so the row shape is not a dead end, and it is called
  out in the M0 consent text.
- **`subject` is the existing `Subject` enum** shared with `StudentProfile`, so
  M2 and M7 inherit one taxonomy. **`problemType` is deliberately free text**
  ("two-step linear equation", "long division") because inventing a skill
  taxonomy is M2's job and M1 must not pre-empt it.
- **`containsSchoolwork: false` maps to `COMPLETE_EMPTY`**, a first-class
  terminal state rather than an empty success. AC 25's "did not find any
  problems" message is driven by it, and it distinguishes "we looked and there
  was nothing" from "we failed".
- **Math is LaTeX inside `text`**, delimited `$…$` inline and `$$…$$` display,
  with `containsMath` as a cheap render hint. Storing `\frac{3}{4}` round-trips
  to the same expression; storing `3/4` does not. That is AC 21.

**Rendering (the other half of AC 21):** `components/uploads/problem-list.tsx` is
a **server component** that calls `katex.renderToString(segment, { throwOnError:
false, trust: false, strict: 'ignore' })` on each `$…$` segment and emits the
result. KaTeX with `trust: false` produces no scriptable HTML, so
`dangerouslySetInnerHTML` is safe here; the input is model output, not user
input, and is length-capped by the schema. Rendering on the server means **no
KaTeX JavaScript ships to the browser** — only `katex.min.css`. The student's
edit form (AC 28) is a plain textarea with no live preview; the re-render
happens on save. That keeps M1's only client-side math cost at zero.

**Execution and the status machine:**

- `POST /api/uploads/confirm` creates `Extraction` in `PENDING` and schedules the
  run with `after()` from `next/server` in the same invocation, with
  `export const maxDuration = 300` on that route. The response returns
  immediately with `extractionId`; the client polls
  `GET /api/extractions/[extractionId]`. This satisfies AC 18's observable
  `PENDING → RUNNING → COMPLETE | COMPLETE_EMPTY | FAILED` without a queue
  service.
- The Anthropic call is `messages.parse({ model: 'claude-opus-5', max_tokens:
  16000, output_config: { format: zodOutputFormat(ExtractionResultSchema),
  effort: 'high' } }, { timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0 })`.
  `maxRetries: 0` is deliberate: the research notes worst-case wall clock is
  `timeout × (maxRetries + 1)`, which would blow the function duration.
- **Checked in this order**, most specific first: `stop_reason === 'refusal'` →
  `FAILED` with `failureCode: 'REFUSED'`; `parsed_output === null` → `FAILED`
  with `PARSE_FAILED`; `APIConnectionTimeoutError` → `FAILED` with `TIMEOUT`;
  typed SDK error classes → `UPSTREAM`. Never string-match an error message.
- **AC 23's "no partial extraction":** the terminal write is a single
  `db.$transaction([updateExtraction, createManyProblems])`. There is no code
  path that writes problems outside that transaction.
- **AC 27's "no request left hanging":** the status GET treats any `RUNNING`
  extraction whose `startedAt` is older than `EXTRACTION_TIMEOUT_MS + 30s` as
  `FAILED` and persists that transition. This covers the case where the function
  is killed mid-`after()` and never gets to write `FAILED` itself. The client
  therefore always reaches a terminal state.
- **AC 24's leak prevention:** `Extraction.failureCode` is an internal enum-ish
  string. The API layer maps it through a fixed lookup to one of four
  user-facing strings. The model id, the raw provider payload, `stop_details`
  and any exception message are logged server-side only and are never placed in
  a response body. A test asserts the response `message` is a member of that
  allowlist.

`LOW_CONFIDENCE_THRESHOLD` (AC 26) is one constant in `lib/config.ts`, starting
at `0.7`.

## Alternatives considered

### Tool use with `strict: true` instead of `output_config.format`
- **Pros:** Also guarantees a validating shape; familiar pattern.
- **Cons:** A tool call is a request for the model to *act*; this is a request
  for it to *report*. It adds a tool-result round trip the flow does not need,
  and `parsed_output` from `messages.parse()` gives typed access directly.
- **Rejected because:** structured output is the narrower tool for the job. Kept
  in mind for M3, where the tutor genuinely does call things.

### Free-text response parsed with a regex or a hand-written parser
- **Pros:** No output-format constraint on the model; possibly better prose.
- **Cons:** Every AC that depends on structure — exact count, ordinals,
  confidence, the separate answer field — becomes a parsing heuristic that fails
  silently on unusual pages. There is no equivalent of AC 23's clean null.
- **Rejected because:** it converts a validated contract into a guess, and AC 19
  ("not four, not six") is unenforceable against a guess.

### Ask for citations as well, so the student can see where a problem came from
- **Pros:** Would make AC 20's "corresponds to a problem on that page" directly
  demonstrable in the UI.
- **Cons:** The research is explicit: `citations` and `output_config.format` in
  one request return 400. Satisfying both needs two calls, two costs and two
  failure modes.
- **Rejected because:** M1 needs the schema more than the provenance, and the
  spec assigns citations to M3.

### Upload each file to the Anthropic Files API and reference it by `file_id`
- **Pros:** The right long-term shape once the same upload is read three or four
  times (M2 generation, M3 chat). File operations are free.
- **Cons:** A second copy of a minor's schoolwork living in a third party's
  storage with its own retention and its own deletion path — every M0/M1
  deletion criterion would have to grow a second leg. M1 reads each upload
  exactly once, so it buys nothing today.
- **Rejected because:** it doubles the compliance surface for a benefit that
  starts in M2. Named in the spec's non-goals so it is not designed out; revisit
  when the second read appears.

### MathML, or a structured expression tree, instead of LaTeX
- **Pros:** MathML renders natively in modern browsers with no library.
- **Cons:** Models emit LaTeX far more reliably than MathML; MathML is verbose,
  which costs output tokens; and the whiteboard research already assumes LaTeX
  in the M4 `LessonScript` (`kind: 'write', latex: string`). Two notations would
  need a converter.
- **Rejected because:** LaTeX is what the model is best at and what M4 already
  expects. Accepting the KaTeX dependency is cheaper than a notation mismatch.

### Render LaTeX client-side with `react-katex`
- **Pros:** Enables a live preview in the edit form.
- **Cons:** Ships KaTeX's JavaScript to every student for output that is
  identical on every render, and forces the problem list to be a client
  component for no interactive reason.
- **Rejected because:** the problem list is static once rendered. Server
  rendering costs one CSS file. Revisit if M4 needs live math editing.

### Store both the raw model text and the parsed rows
- **Pros:** Debuggable; re-parseable if the schema changes.
- **Cons:** The raw payload is a verbatim copy of a child's schoolwork in a
  second column with no deletion path of its own, and AC 24 requires the raw
  provider payload never to escape.
- **Rejected because:** it is more sensitive data for developer convenience. We
  log a hash and token usage, not content.

## Consequences

### Positive
- One schema is the model contract, the API validator and the TypeScript type —
  no parallel interfaces to drift.
- Every failure mode (refusal, null parse, timeout, upstream) lands in a named
  terminal state with a retry, so the UI has no undefined branch.
- Storing LaTeX makes AC 21 objectively testable: the fixture's expected text is
  compared literally.
- Nothing about mastery, skills or difficulty is modelled, so M2 is unconstrained.

### Negative / accepted trade-offs
- `claude-opus-5` at `effort: 'high'` is roughly $0.06 per extraction (research
  §9, computed not quoted) and is the slowest call in M1. Cost per upload scales
  linearly with usage and there is no caching — the extraction prefix is small
  and per-upload, so prompt caching does not pay here.
- Whether a `high`-effort call reliably completes inside the function duration is
  **unverified**; the research calls it the single biggest unvalidated
  assumption. Plan §9's second spike measures it. If it does not fit, the
  status machine already specified becomes load-bearing and extraction moves to
  a queue — the schema, the rows and the UI are unaffected.
- Extraction accuracy is only as good as our fixtures. AC 19 and AC 20 are
  tested as exact-set equality against three committed worksheets with
  hand-written expected output. Real-world accuracy is unmeasured, and we should
  say so rather than imply coverage.
- `ordinal` gaps after deletion are correct but look odd in raw data; the UI
  must not present the ordinal as "problem number".
- KaTeX ships a CSS file and font files to every page that lists problems.

### Follow-up required
- [ ] Owner approval for `@anthropic-ai/sdk`, `katex` and `@types/katex`.
- [ ] Add `ANTHROPIC_API_KEY` to `.env.example` as **server-only** — never
      `NEXT_PUBLIC_`.
- [ ] Commit three fixture worksheets (one five-problem math page, one page with
      handwritten answers, one pet photo) with hand-written expected output.
- [ ] Run plan §9 spike B and record measured p50/p95 extraction latency.
- [ ] Re-verify Anthropic pricing at the live page before any budget uses the
      $0.06 figure.
- [ ] Decide whether `studentAnswerText` needs its own consent scope before M7
      consumes it (M1 open question).

## Revisit when

The same upload is read a second time (Files API becomes worthwhile); or
measured extraction latency exceeds the function duration (extraction becomes a
background job); or M2's skill taxonomy lands and `problemType` should become an
enum; or the fixture suite shows `effort: 'high'` is more than the page needs.
