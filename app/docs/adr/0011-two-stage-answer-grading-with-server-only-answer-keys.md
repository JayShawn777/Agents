# ADR-0011: Grade with a deterministic normaliser first and the model second, and keep answer keys in their own table

## Revision 2026-08-27 — the grader reads attacker-controlled text

This ADR's two-stage design is unchanged. What was missing is that stage two's
request is assembled from strings the student controls: `submittedAnswer` is up
to `PRACTICE_ANSWER_MAX_LENGTH` characters of anything, and `problemText`
descends from a photograph plus whatever the student typed when correcting the
extraction (M1). Both were interpolated raw.

Exfiltration was never the risk — the request carries a grade level and a
subject and nothing else (M2 AC 27), and structured output bounds the reply.
The risk is that a student can address the grader that marks them, and
ADR-0010's ratchet makes a resulting inflated `SkillMastery.level` permanent
and un-lowerable, under a parent report that presents it as evidence.

Both spans are now fenced by `lib/ai/untrusted.ts` and both system prompts
carry `UNTRUSTED_INPUT_RULE`. That is mitigation, not a fix — prompt injection
has no fix — so the controls that actually decide anything stay in code and are
unchanged by this revision: §4's `stripAnswerFromHint` post-check, ADR-0009 §2's
closed `skillCode` enum, and the post-reveal short-circuit in
`lib/mastery/apply.ts`. `MASTERY_MIN_ATTEMPTS_FOR_REPORT` (ADR-0010's revision
note) is the fourth, and is the one still waiting on its consumer.


- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m2-practice-and-mastery.md

## Context

M2's spec names this as an open question and hands it to the architect:

> **How is answer equivalence judged (AC 13)?** THREE OPTIONS: ask the model to
> grade with the answer key in context; normalise and compare strings; add a
> computer-algebra dependency. The third is a new major dependency and needs the
> owner's approval. The first is untested for reliability on child-written
> answers. **Needs a measured fixture run before the approach is fixed.**
> Blocking for AC 13.

The criteria that constrain the answer:

- **AC 13** — `0.5` for `1/2`, `x = 3` for `3`, `2/4` for `1/2` where unsimplified
  forms are accepted, all graded **correct**. *"A fixture table of equivalent
  forms is the test."* A fixture table implies a deterministic function.
- **AC 14** — an answer that cannot be confidently graded either way is
  `UNSCORED`, the student is **not told they are wrong**, and no mastery counter
  is decremented.
- **AC 11** — a first incorrect attempt gets a nudge, and *"the feedback text does
  not contain the canonical answer from the answer key."*
- **AC 17** — the answer key is **not present** in any payload delivered to the
  browser before the attempt is submitted: HTML, JSON, **or client bundle**.
- The spec's own assumption: grading *"runs server-side on submission,
  synchronously, and returns fast enough to feel immediate."*

Two things in that list pull in opposite directions. AC 13's fixture table wants
a pure function. AC 14's "cannot be confidently graded" wants judgement. And AC 17
is a leak-prevention requirement that has nothing to do with equivalence but
everything to do with where the key is stored, because in an App Router codebase
the dangerous path is not a hand-written JSON response — it is a server component
loading a row and passing it to a client component, which serialises the whole
object into the RSC flight payload where nobody looks.

## Decision

We will grade in **two stages plus an honest third outcome**, and we will store
the answer key in a **separate table** so that the leak AC 17 forbids is not
possible to write by accident.

### 1. Stage one — a deterministic normaliser (`lib/grading/normalize.ts`)

Pure. No database, no network, no model. Takes `(raw: string, format:
AnswerFormat)` and returns a canonical form, or `null` when the input is outside
its domain.

Its domain is deliberately narrow and exactly covers AC 13's examples:

| Handled | Example |
|---|---|
| Whitespace, case, unicode minus/dashes, thousands separators | `−3`, `1,024` |
| A leading `variable =` prefix | `x = 3` → `3` |
| Integers and decimals as exact rationals | `0.5` → `1/2` |
| Fractions, including improper and unsimplified | `2/4` → `1/2` |
| Mixed numbers | `1 1/2` → `3/2` |
| Trailing units and `$` where the format expects them | `$4.50`, `12 cm` |
| Percent | `50%` → `1/2` where the format is `NUMERIC` |
| Short text: casing, articles, trailing punctuation | `The Nile.` → `nile` |

Comparison is exact equality of canonical forms, against the key **and** against
each entry in `acceptedForms`. Rational arithmetic is done on `bigint` numerator
and denominator — no floating point, so `0.1 + 0.2` never appears.

Anything the normaliser cannot parse returns `null` and falls to stage two. It
never guesses.

**AC 13's fixture table is a table-driven unit test over this function**, with no
mocks, no database and no network. That is the whole point of stage one existing.

### 2. Stage two — model adjudication, only on a stage-one miss

One `messages.parse()` call at `GRADING_EFFORT = 'low'` and
`GRADING_TIMEOUT_MS = 15_000`, with a schema that has exactly three verdicts:

```ts
const GradingResult = z.object({
  verdict: z.enum(['CORRECT', 'INCORRECT', 'UNSURE']),
  hint: z.string().min(1).max(HINT_MAX_LENGTH),
});
```

The request carries the problem text, the canonical answer, the accepted forms
and the student's submission. It carries **no identifier** — it takes the shared
`OutboundLearnerFacts` type, which structurally has no name, no id and no email
field (AC 27).

The prompt states that the hint must guide and must not contain the answer, and
`UNSURE` is described as the correct output when the submission is ambiguous,
blank-adjacent, off-topic or in a form the grader cannot judge.

### 3. Stage three — `UNSCORED` is a real outcome, not an error

`verdict: 'UNSURE'`, a refusal, a null `parsed_output`, a timeout, or any
upstream failure all produce `result: UNSCORED`, `gradedBy: UNGRADED`.

The student sees "I'm not sure about that one — want to try writing it a
different way?" They are **not** told they are wrong (AC 14). No counter moves
except `attemptCount`, and `consecutiveCorrect` is left **unchanged** rather than
reset — an ungraded attempt is not evidence in either direction.

This means a total Anthropic outage degrades practice to "answers are recorded,
nothing is judged" instead of to an error page. That is the right failure
direction for a child mid-set.

### 4. The hint may not contain the answer, and that is checked, not trusted

AC 11 is enforced by a post-check in `lib/grading/adjudicate.ts`, not by the
prompt:

```
if (normalize(hint) contains normalize(canonicalAnswer)
    || hint contains canonicalAnswer verbatim
    || any acceptedForm appears verbatim in hint)
  -> discard the hint, substitute HINT_FALLBACK
```

Cheap, deterministic, and it is what the AC actually asks us to assert. The same
check guards M3's chat replies (AC 3) and is exported once.

### 5. Answer keys live in `PracticeAnswerKey`, a separate table

```prisma
model PracticeProblem  { id, practiceSetId, ordinal, skillCode, text, ... }
model PracticeAnswerKey {
  practiceProblemId String @id
  canonicalAnswer   String
  acceptedForms     String[]
  workedSolution    String     // AC 12, revealed only after ATTEMPTS_BEFORE_REVEAL
}
```

This is the structural half of AC 17. With the key on a separate table:

- `db.practiceProblem.findMany({ where: { practiceSetId } })` — the query a page
  writes without thinking — **cannot** return it.
- A server component passing a `PracticeProblem` row into a client component
  serialises no key into the RSC payload.
- Reaching the key requires typing `include: { answerKey: true }` or querying
  `practiceAnswerKey` directly, which is one grep for a reviewer and one lint
  rule if we ever want one.

`lib/grading/*` is the only module that may read it, plus the reveal endpoint
once `ATTEMPTS_BEFORE_REVEAL` incorrect attempts exist.

The reveal endpoint (`POST /api/practice-problems/[id]/reveal`) returns **409**
unless the incorrect-attempt count has reached the threshold. Without that gate a
client simply calls reveal first and AC 17 is decorative.

## Alternatives considered

### Model-only grading, with the key in context on every submission
- **Pros:** One code path. Handles every subject and every answer format,
  including short text and reasoning, with no domain to maintain. It is what the
  spec lists first.
- **Cons:** AC 13's "fixture table of equivalent forms is the test" becomes a
  test of a mocked model — it proves nothing about grading and everything about
  our mock. Every submission costs a call and 1–3 seconds on the interactive path,
  against the spec's own "fast enough to feel immediate". `0.5` vs `1/2` is a
  decidable question and paying a language model to decide it is both slower and
  less reliable than deciding it. And an Anthropic outage stops a child mid-set.
- **Rejected because:** it makes a decidable question probabilistic, and it makes
  the AC's own stated test meaningless.

### Normalise-and-compare only, with no model stage
- **Pros:** Free, instant, fully deterministic, trivially testable, no outage
  dependency.
- **Cons:** Everything outside the normaliser's domain is a false `INCORRECT` —
  a right answer marked wrong, which is the worst possible failure for a child
  and directly attacks the trust the product needs. Short-text and
  multi-step-expression answers are simply out of reach.
- **Rejected because:** the failure mode is a child being told they are wrong when
  they are right, silently, with no path to detect it.

### Add a computer-algebra dependency (`mathjs`, `nerdamer`, `algebrite`)
- **Pros:** Genuinely decides symbolic equivalence for expressions, which is the
  hard case the normaliser cannot reach. `2(x+1)` vs `2x+2` becomes decidable.
- **Cons:** A new major dependency requiring the owner's approval, and a large
  one. More importantly, `simplify()` is **not a decision procedure** — a CAS that
  fails to simplify two equivalent expressions to the same normal form returns a
  confident false negative, which is the same "told they are wrong when they are
  right" failure wearing a maths hat, and now it is buried in a third-party
  library. `mathjs`'s parser also accepts a large expression language, so a
  student's submission becomes an input to an evaluator, which is a surface we
  would have to reason about.
- **Rejected for now because:** it needs approval, its failure mode is silent and
  wrong, and the model stage covers the same cases with a `UNSURE` escape hatch
  that a CAS does not have. Named as the revisit trigger if measured `UNSCORED`
  rates on expression answers turn out to be high.

### Keep the key as columns on `PracticeProblem` and enforce AC 17 with a DTO rule
- **Pros:** One table, one query, no join on the grading path.
- **Cons:** The DTO is not the only path to the browser. An RSC flight payload
  carries whatever a server component hands a client component, and a reviewer
  reading a page component sees `problems` being passed down and has no signal
  that one of those fields is an answer key. The rule would hold until the first
  convenient `include`.
- **Rejected because:** AC 17 names the **client bundle** and **HTML** explicitly,
  not just JSON. A structural guarantee costs one join on one code path and buys
  a criterion we cannot afford to satisfy by discipline.

### Grade asynchronously, with the same status machine as generation
- **Pros:** Uniform with practice generation and extraction; no latency budget on
  the request; survives a slow model.
- **Cons:** A child types an answer and waits for a poll to tell them whether it
  was right. It converts the tightest feedback loop in the product into a job
  queue. Stage one returns in microseconds for the common case, so the latency
  problem this solves mostly does not exist.
- **Rejected because:** the spec's assumption is synchronous and the interaction
  demands it. If measured p95 on stage two is bad, the mitigation is to widen the
  normaliser's domain, not to make correct answers wait.

## Consequences

### Positive
- AC 13 is tested by a pure table-driven unit test with no mocks — the strongest
  test in M2, and the one that will still be true in a year.
- The common case (a number, a fraction, a decimal) costs nothing and returns
  instantly. Only genuinely ambiguous submissions pay for a model call.
- `UNSCORED` is a designed state rather than an error branch, so an upstream
  outage degrades gracefully instead of blocking a child mid-set.
- AC 11 and M3 AC 3 share one post-check, so "never hand over the answer" is one
  function rather than two prompts we hope behave.
- AC 17 is a schema property. The dangerous path — a server component serialising
  a row into a client component — cannot reach the key at all.

### Negative / accepted trade-offs
- **The normaliser is a maintained domain and it will be wrong at its edges.**
  Every new answer format is a new branch and a new fixture row. It is the kind of
  code that accretes special cases.
- **Two grading paths means two behaviours**, and a student can get a different
  verdict for the same answer written two ways if one form parses and the other
  falls to the model. Mitigated by feeding the normaliser's canonical form to the
  model as well, so the two stages see the same input.
- **`UNSCORED` is invisible to everyone except the logs.** A high rate means the
  grader is failing and the child is quietly getting no feedback. It must be a
  metric watched from the first real user, not a state we ship and forget.
- **A wrong-but-confident model verdict is undetectable in CI.** Stage two is
  tested with a mock. Its real accuracy on child-written answers is unmeasured,
  which is exactly what the spec's open question says, and this ADR does not
  change that — it only bounds how often stage two is reached.
- The reveal endpoint's 409 gate means the client must track the attempt count, or
  it will hit a 409 it did not expect. That is in the contract, but it is a place
  the two tracks could disagree.
- One join on the grading path. Negligible.

### Follow-up required
- [ ] **Run the measured fixture set the spec asks for, before AC 13 is signed
      off:** at least 40 hand-written (problem, key, submission) triples drawn
      from real child answers if any exist, scored against both stages. Record
      what fraction stage one decides, what fraction stage two decides, and the
      `UNSCORED` rate. Those three numbers decide whether the normaliser's domain
      needs widening or whether a CAS is worth its approval.
- [ ] Decide `HINT_MAX_LENGTH` and write `HINT_FALLBACK`'s copy. A fallback hint a
      child reads three times in a row is its own failure.
- [ ] A test asserting `PracticeProblemDTO`'s key set exactly, and a second test
      that serialises a whole practice-set page payload and asserts the canonical
      answer string is absent from it (AC 17, the RSC path).
- [ ] Log `UNSCORED` counts per skill from the first deploy. This is the number
      that tells us the grader is failing, and there is no other signal.

## Revisit when

Measured `UNSCORED` rates on expression-format answers exceed what the product
can tolerate (a CAS becomes worth its approval and its silent-false-negative
risk); or a subject arrives whose answers the normaliser cannot represent at all
(reading comprehension, writing), which is a scope decision before it is a
grading one; or stage two's measured accuracy on child-written answers turns out
to be poor enough that `UNSURE` should be the default rather than the fallback.
