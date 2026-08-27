# ADR-0016: Foreign language is proficiency-banded, not grade-banded

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** owner (pending)
- **Spec:** docs/specs/m8-spoken-language.md (its "Dependency" section), and the
  coverage note in `lib/taxonomy/index.ts`

## Context

`FOREIGN_LANGUAGE` is a `Subject` enum member with no skills bundled, and
`tests/unit/lib/taxonomy/index.test.ts` asserts it is non-gradable so that
adding it must be deliberate. It is the last gap against the product's stated
subject coverage.

Two things block it, and only one of them is the one everybody names.

**The banding problem.** `Skill` carries a `GradeLevel`, and `candidateSlate`
filters by proximity to the student's grade using `SKILL_GRADE_BAND`. ACTFL —
the framework a US K-8 world-language course is measured against — is organised
by *proficiency*, not grade. A first-year Spanish learner may be in grade 3 or
grade 8; a grade-8 beginner and a grade-3 beginner need the same skills. Mapping
proficiency onto grade means inventing a correspondence ACTFL does not publish,
and it produces exactly the wrong answer for the most common case: an older
beginner, whose grade-centred band would exclude every skill they actually need.

**The language problem, which is the real blocker.** ACTFL descriptors are
language-agnostic — "can produce isolated words and high-frequency phrases"
holds for Spanish and for Japanese. That is convenient for the taxonomy and
useless for generation, because writing practice requires knowing *which*
language. `ExtractedProblem` records `subject` and no language. The extraction
model is told to guess a subject; nothing asks it what language the page is in.
So even with a perfect taxonomy, generation could not write a single problem.

Doing nothing keeps foreign language permanently undeliverable while the product
claims it, which is the same defect class as the 2026-08-27 coverage fix: a
promise with no machinery behind it and tests that pass because they never ask.

## Decision

**We will exempt foreign language from grade banding, band it by proficiency
instead, and record the language on the extracted problem.**

1. `Skill` gains an optional `proficiency` field. A skill carries *either* a
   `gradeLevel` (every framework bundled today) *or* a `proficiency` (ACTFL),
   never both, and the type expresses that as a discriminated union rather than
   two optional fields that can both be null.

2. `candidateSlate` **stays pure.** It gains an optional `proficiencyAnchor`
   argument and skips grade filtering for skills that carry a proficiency. It
   does not read the database, does not derive the anchor, and does not import
   `server-only` — that module's purity is load-bearing (both tracks import it,
   including the frontend) and is not being spent here.

3. The **caller** derives the anchor. `lib/practice/generate.ts` already has
   database access; it computes the student's current proficiency from existing
   `SkillMastery` rows — the highest proficiency at `SECURE`, defaulting to the
   lowest rung when there are none — and passes it in. No schema change, no new
   column, no placement test (M7's non-goals forbid one).

4. `ExtractedProblem` gains a nullable `language` column, populated by the
   extraction model, validated at persistence against a bundled allowlist in
   `lib/config.ts` the same way a `skillCode` is validated against the taxonomy.
   A string plus an allowlist rather than a Prisma enum: the supported set will
   change more often than a migration should, and the validation belongs where
   every other model-supplied value is already checked.

## Alternatives considered

### Map ACTFL proficiency onto grade levels
- **Pros:** No type change, no new argument, no branch in `candidateSlate`.
- **Cons:** Invents a correspondence the framework does not publish, and gets
  the older-beginner case exactly backwards — a grade-8 novice's band would
  centre on grade 8 and exclude every novice skill.
- **Rejected because:** it encodes a falsehood in data, which is harder to find
  later than a branch in code.

### Exempt foreign language from banding entirely — send the whole slate
- **Pros:** Simplest possible change; no anchor, no new field.
- **Cons:** The slate is the closed menu the model must choose from (ADR-0009
  §2). An unbounded menu makes the choice meaningless and the prompt large, and
  it hands a novice's worksheet a menu containing advanced skills.
- **Rejected because:** it discards the mechanism that makes generated skill
  codes trustworthy, to avoid one argument.

### A `proficiency` column on `StudentProfile`
- **Pros:** Explicit, readable, no derivation.
- **Cons:** Something has to set it. The honest ways are a placement test (M7
  forbids one) or asking a parent to self-report their child's proficiency,
  which is a question most parents cannot answer accurately.
- **Rejected because:** it adds a column whose value nothing can populate well,
  when `SkillMastery` already holds the evidence.

### A `Language` Prisma enum instead of a validated string
- **Pros:** Type safety at the database boundary.
- **Cons:** Every added language is a migration, and the supported set is
  product-driven and will move.
- **Rejected because:** the taxonomy already establishes the pattern — an open
  column validated against a bundled, versioned allowlist.

## Consequences

### Positive
- The last uncovered subject becomes reachable, through machinery that exists.
- A grade-8 beginner and a grade-3 beginner get the same slate, which is the
  correct behaviour and the one a grade mapping would have broken.
- `candidateSlate` stays pure and stays importable by the frontend.
- `ExtractedProblem.language` is useful beyond this ADR: M8's spoken practice
  needs it, and so does any future narration in a language other than English.

### Negative / accepted trade-offs
- `Skill` becomes a union, so every consumer must handle both arms. There are
  few today; there will be more later, and doing this after M3-M7 build on the
  flat shape would be materially worse.
- The proficiency anchor is derived, so it is only as good as the mastery rows
  behind it. A student with no foreign-language history anchors at the lowest
  rung — correct for a true beginner, mildly annoying for a returning learner,
  and self-correcting after a few sets.
- ACTFL's descriptors are **paraphrased**, exactly as CCSS/NGSS/C3 already are
  in `skills-k8.json`. The licence question ADR-0009's revision left open now
  spans a fifth framework.

### Follow-up required
- [ ] Migration adding `ExtractedProblem.language` (nullable, no backfill —
      existing rows predate the field and are not foreign language).
- [ ] Extraction prompt and schema updated to report the language.
- [ ] `TAXONOMY_VERSION` bump when the ACTFL skills land.
- [ ] Read ACTFL's licence and confirm the attribution obligation before
      descriptors ship to a parent — joining ADR-0009's identical open item for
      CCSS, NGSS and C3.
- [ ] Flip the "FOREIGN_LANGUAGE is not yet covered" assertion in
      `tests/unit/lib/taxonomy/index.test.ts`, which exists precisely to force
      this to be deliberate.

## Revisit when

A language is requested whose skills are genuinely not proficiency-shaped — a
classical language taught as grammar-and-translation from year one, say — or
when a real placement signal exists and the derived anchor stops being the best
available answer.
