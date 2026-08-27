# ADR-0009: A bundled standards subset, and the model picks from a closed slate

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m2-practice-and-mastery.md

## Revision 2026-08-27 — §4 replaced; the bundle is no longer Common Core alone

Revised in place under docs rule 3 (a **Proposed** ADR may be revised with a
dated note saying what changed and why).

**What changed.** §4 originally scoped the bundle to Common Core and declared
`GRADABLE_SUBJECTS = ['MATH', 'SCIENCE']`. That is replaced: the bundle now
carries **four frameworks** — CCSS (math, ELA), NGSS (science) and C3 (social
studies) — the data file is `lib/taxonomy/skills-k8.json`, and the gradable set
is **derived from coverage** rather than declared. See the new §4 below.

**Why.** Two reasons, one product and one defect.

The product reason: the owner confirmed on 2026-08-27 that this is a tutor for
math, reading, language arts, social studies and science — not a math app that
tolerates other subjects. A first cut scoped to one framework put the product's
core promise behind a data file nobody was scheduled to revisit.

The defect reason, which matters more, is that §4's own reasoning did not
survive contact with the implementation. It said science would be "generated
against the math-shaped machinery only where a math standard genuinely applies."
`candidateSlate` never did that and could not — it filters strictly on
`skill.subject`, and no bundled skill was tagged `SCIENCE`. So the two lists
ended up almost exactly inverted: **science was declared gradable with zero
science skills bundled**, meaning every science worksheet passed the gradability
filter and then died as `SLATE_EMPTY`; while **ELA had 18 usable skills and was
excluded one step earlier**. 501 tests passed over this, all of them using math.

The lesson is the one the M0-M2 retro already records as #11 — green gates
answer a different question from "does the thing work" — and the fix is
structural rather than a corrected constant: `GRADABLE_SUBJECTS` is now computed
from `SUBJECT_FAMILY` and the loaded bundle, so a subject cannot be declared
gradable unless skills for it exist. That class of drift is now unrepresentable.

## Context

M2 AC 7 requires every persisted practice problem to carry **exactly one primary
skill code drawn from a bundled standards taxonomy**, resolving to a
human-readable descriptor and a grade level, and requires a problem whose code is
**not present in the taxonomy to be rejected and not persisted**. AC 8 requires
every persisted problem's skill grade level to sit inside a configured band of
the student's own grade level, again rejected before persistence. AC 9 requires
the descriptor — not the raw code — to be what the student sees.

The spec's non-goals forbid inventing a taxonomy in terms: *"We map to an
existing published standards taxonomy. Inventing a bespoke skill tree is
explicitly forbidden by this spec."*

`docs/research/tutoring-product-patterns.md` §6 establishes the options: Common
Core State Standards (math and ELA) plus NGSS for science are what IXL and Khan
Academy align to, and 1EdTech's **CASE** is the machine-readable interchange
format, served as JSON over a REST API from the CASE Network registry. §5 adds
that in both dominant systems the **unit of practice is the skill, not the
standard** — standards are a tag applied on top.

Two things are unresolved by that research and have to be decided here.

**First, where the taxonomy lives.** A REST call to CASE at request time, a
seeded database table, or a file in the repository are three different
operational stories with three different failure modes.

**Second, and much more consequential: how a code gets onto a row at all.**
Nothing in the spec says. If we ask the model for a free-text skill name and map
it ourselves, we need a matcher and the matcher is a new source of silent error.
If we ask the model for a code, it will confidently emit `4.NF.B.3c` whether or
not that code exists, and AC 7's rejection path becomes the normal case rather
than the exception — six problems generated, three discarded, and the student
gets a short set for reasons nobody can see.

M7 makes this worse in a way M2 does not have to think about but the schema does:
`SkillMastery` is keyed by skill code, the review schedule hangs off it, and the
parent report renders the descriptor. A code that drifts is a mastery record that
silently splits in two.

## Decision

We will **check a static, versioned JSON subset of Common Core into the
repository**, expose it through one pure module, store the code on rows as a
plain `String` with no foreign key, and — the load-bearing half — **give the
model a closed slate of candidate codes in the request and constrain its output
to that slate with a zod enum.**

### 1. The artifact

`lib/taxonomy/ccss-k8.json`, plus `lib/taxonomy/index.ts`:

```ts
export type Skill = {
  code: string;        // "4.NF.B.3"
  descriptor: string;  // "Add and subtract fractions with unlike denominators"
  gradeLevel: GradeLevel;
  subject: Subject;    // MATH | ENGLISH_LANGUAGE_ARTS
};

export const TAXONOMY_VERSION: string;                       // from lib/config.ts
export function resolveSkill(code: string): Skill | null;    // AC 7, AC 9
export function candidateSlate(args: {
  subject: Subject;
  gradeLevel: GradeLevel;
  bandGrades: number;                                        // SKILL_GRADE_BAND
}): Skill[];                                                 // AC 8, by construction
```

The module is **pure**: no database, no network, no `server-only`. Both tracks
import it — the backend to build the slate and validate, the frontend to render
`skillDescriptor` (AC 9) without a round trip.

The JSON is generated once by a committed script from a public CCSS source, and
the source URL, the fetch date and the derivation script are recorded in
`docs/research/`. It is reviewed as a diff like any other file.

### 2. The closed slate — how a code reaches a row

Practice generation resolves the slate **before** the model is called, from the
student's `gradeLevel` and the subject of the source extracted problem, widened
by `SKILL_GRADE_BAND` (1) in both directions. The generation schema is then built
against that slate:

```ts
const slate = candidateSlate({ subject, gradeLevel, bandGrades: SKILL_GRADE_BAND });
const codes = slate.map((s) => s.code) as [string, ...string[]];

const GeneratedProblem = z.object({
  skillCode: z.enum(codes),          // <- the slate, not a free string
  text: z.string().min(1).max(2000),
  // ...
});
```

The slate — code **and** descriptor for each entry — is also rendered into the
user prompt, so the model is choosing from a visible menu rather than recalling a
notation. `zodOutputFormat()` carries the enum into the request as a structural
constraint on the output (ADR-0005's mechanism, unchanged).

Consequences that fall out for free:

- **AC 7's rejection path becomes unreachable in the normal case.** A code
  outside the taxonomy cannot validate, so `parsed_output` is null and the whole
  set is `FAILED` with zero rows (AC 5's behaviour, already specified) rather
  than a silently short set. The persistence-time check against the same slate
  stays as a belt-and-braces assertion and is tested, but it is a second line.
- **AC 8 is satisfied by construction, not by a filter.** Every code the model
  can emit is already inside the band, because the slate was built from it.
- The prompt is bounded. A K–8 Common Core math subset is on the order of 400
  standards; a single grade band of one subject is on the order of 30–60, which
  is a few hundred tokens.

### 3. Storage: a string, no foreign key

`PracticeProblem.skillCode` and `SkillMastery.skillCode` are `String`. There is
no `Skill` table and no relation.

`PracticeSet.taxonomyVersion` records which taxonomy generation produced the set,
so a later version bump is legible in the data rather than inferred.

`resolveSkill()` returns `null` for a code the current taxonomy does not carry.
Every caller handles null by falling back to a neutral label ("this skill") and
logging the unresolvable code — the same shape as M5 AC 3's unresolvable voice
id. A retired code never breaks a page.

### 4. Which subjects are in scope

**Revised 2026-08-27 (see the revision note at the top).** The bundle carries
four published frameworks, K-8:

| Framework | Subject | Codes look like |
|---|---|---|
| Common Core (CCSS) | `MATH` | `4.NF.B.3` |
| Common Core (CCSS) | `ENGLISH_LANGUAGE_ARTS` | `8.RI.2` |
| Next Generation Science Standards (NGSS) | `SCIENCE` | `MS-PS1-1` |
| College, Career & Civic Life (C3) | `SOCIAL_STUDIES` | `D2.His.1.3-5` |

`GRADABLE_SUBJECTS` is **not written down**. It is derived in
`lib/taxonomy/index.ts` from `SUBJECT_FAMILY` intersected with the subjects the
loaded bundle actually has skills for. A subject becomes gradable by adding its
skills to the data file and pointing at them in the map — never by editing a
list. This is the load-bearing half of the revision: the original defect was two
hand-maintained lists disagreeing, and derivation is what makes them unable to.

**`SUBJECT_FAMILY` exists because the `Subject` enum is finer-grained than the
frameworks.** `READING` and `WRITING` are separate enum members but both are
graded against CCSS ELA; `HISTORY` is graded against C3, which publishes history
as one of its four social-studies dimensions. Without the map, a reading
comprehension worksheet would resolve to an empty slate — the same failure
science used to hit, relocated rather than fixed.

**Uncovered subjects are refused cleanly, and named.** `FOREIGN_LANGUAGE`,
`COMPUTER_SCIENCE` and `OTHER` have no bundled framework and yield an empty
slate, which is the `SLATE_EMPTY` path — no AI call, no bad grade. A unit test
asserts `FOREIGN_LANGUAGE` is not gradable specifically so that adding ACTFL
later has to change that assertion deliberately rather than by accident.

`FOREIGN_LANGUAGE` is the notable gap against what the product promises. ACTFL's
World-Readiness Standards are organised by **proficiency level** (Novice Low /
Mid / High), not by grade, so bundling them means deciding how proficiency maps
onto `GradeLevel` — a mapping ACTFL does not publish. Inventing one is exactly
what the spec's non-goals forbid, so it is left uncovered and visible rather
than faked. It needs its own ADR.

**Grade banding.** CCSS and NGSS K-5 are per-grade and are recorded as written.
NGSS middle school (`MS-`) and every C3 standard are published as bands (K-2,
3-5, 6-8). Each banded standard is placed at its band's **middle** grade —
`GRADE_1`, `GRADE_4`, `GRADE_7` — so `SKILL_GRADE_BAND = 1` reaches the whole
band from any grade inside it. A code appears exactly once; duplicating it per
grade would make the code→skill map lossy, and the map is what `SkillMastery`
rows hang off.

## Alternatives considered

### Call the CASE Network API at request time
- **Pros:** Always current. No repository artifact to maintain. Access to state
  frameworks (Texas, Virginia) without shipping each one. This is the standard
  the category actually uses.
- **Cons:** A third-party network call on the critical path of every generation,
  with its own latency, availability and failure mode, for reference data that
  changes on the timescale of years. It is a new outbound vendor, which means a
  new name in the §312.4 direct notice (M0 AC 13) and a new row in the vendor
  capability assessment (M0 AC 52) — for a lookup table. A CASE client is also a
  new major dependency needing the owner's approval, and the spec's own non-goals
  list "CASE-based dynamic loading of standards frameworks" as out of scope.
- **Rejected because:** it converts a static file into a vendor relationship and
  a compliance surface. Revisit when we need state frameworks.

### Seed the taxonomy into a `Skill` table with a real foreign key
- **Pros:** Referential integrity — AC 7 becomes a constraint violation rather
  than a code path. Descriptors join in one query. A retired code cannot dangle.
- **Cons:** Reference data in the database has to be seeded, and a taxonomy edit
  becomes a data migration against production rather than a diff. The frontend
  can no longer render a descriptor without a query, so AC 9 costs a round trip
  on every practice problem. Worst: `deleteStudentData` and the retention job now
  walk a table that is *not* student data, and every reviewer has to re-establish
  that it is exempt. Every other model in this schema is either student data or
  audit evidence; a third category earns its keep only if it buys something.
- **Rejected because:** the integrity it buys is already bought by the closed
  slate — an invalid code cannot be produced in the first place — and it costs
  the "reference data is a file you can read in a diff" property.

### Let the model emit a free-text skill name, then map it to a code ourselves
- **Pros:** No slate in the prompt, so a shorter request. The model is not
  constrained to a notation it may not know well.
- **Cons:** The mapper is the whole problem, relocated. Exact string matching
  fails constantly ("adding fractions with different bottoms"); fuzzy matching
  needs a threshold nobody can justify; embeddings are a new dependency and a
  second model call. Every mismatch is silent and lands as a wrong mastery record
  rather than a visible failure.
- **Rejected because:** it moves an error we can make structurally impossible
  into a heuristic we would have to tune forever.

### Ask the model for a free `skillCode` string and validate after the fact
- **Pros:** Simplest prompt. Exactly what AC 7's rejection sentence describes.
- **Cons:** The model does not reliably recall Common Core notation, so
  rejections are the normal case, not the exception. AC 5 then fires constantly
  (`FAILED`, zero problems), or — if we discard per-problem instead — the student
  gets a three-problem set with no explanation. Neither is acceptable and both
  are expensive, because the whole set is regenerated.
- **Rejected because:** it makes a correctness mechanism into the common path.

### Invent our own skill tree
- **Pros:** Fits our content exactly. No licensing question. Arbitrary
  granularity.
- **Cons:** Explicitly forbidden by the spec's non-goals; no parent recognises
  the vocabulary, which defeats the "words I recognise from school" user story;
  and the whole category has already converged on Common Core.
- **Rejected because:** the spec forbids it and the research says why.

## Consequences

### Positive
- AC 7 and AC 8 are enforced by the shape of the request, not by a filter that
  can be forgotten. The zod enum is simultaneously the model's constraint, the
  API validator and the TypeScript type — the same property ADR-0005 established
  for extraction.
- The descriptor is available to the browser with no query, so AC 9 is a render,
  not a round trip.
- A taxonomy change is a reviewable diff with a version bump, not a production
  data migration.
- `SkillMastery` is keyed on a stable public identifier, which is what makes M7's
  review schedule and the parent report's "skills practised" list coherent across
  a year of use.
- The taxonomy is not student data, has no deletion story to get wrong, and
  appears in no retention row. That is a deliberate simplification.

### Negative / accepted trade-offs
- **The slate is a per-request dynamic zod enum**, which means the generation
  schema is built at call time rather than declared once at module scope. Slightly
  less idiomatic than ADR-0005's static `ExtractionResultSchema`, and it means
  the schema cannot be snapshot-tested as one object; it is tested as a function
  of its inputs instead.
- **A wrong-but-valid code is undetectable.** The slate guarantees the code
  exists and is in-band. It says nothing about whether it is the *right* skill for
  that problem. This is a real accuracy gap with no automated test, and it feeds
  mastery and the parent report. Named in the plan's "not automatically testable"
  list.
- **Grade band is a blunt instrument.** A grade-4 student genuinely working at
  grade-2 level gets a slate that excludes what they need. `SKILL_GRADE_BAND` is
  configuration, and M7's learner profile is the eventual answer; M2 has none.
- **Science is not really covered.** NGSS is not bundled, so science practice
  leans on math standards or is refused. Honest, and narrower than the product
  will eventually want.
- The CCSS text carries a public licence with an attribution requirement. Nobody
  has read it. It must be read before the descriptors appear in a parent-facing
  surface.

### Follow-up required

Updated 2026-08-27 with the revision. The licensing and provenance items got
**wider**, not narrower — they now cover four frameworks with three different
attribution regimes, and every descriptor in the bundle is a paraphrase rather
than a verified reproduction.

- [ ] **Someone must read each framework's licence** — CCSS, NGSS and C3 — and
      confirm the attribution obligation before descriptors ship to a parent.
      They are three different licensors with three different terms; clearing
      one does not clear the others. This is a legal check, not an engineering
      one, and it is the highest-priority item in this list.
- [ ] Record the source URL, fetch date and derivation script for each framework
      in `skills-k8.json` in `docs/research/`, per the knowledge-base rule that a
      finding with no source cannot be re-verified. The file is currently hand
      authored from well-known identifiers with paraphrased descriptors — see
      the flagged deviation at the top of `lib/taxonomy/index.ts`.
- [x] A unit test asserting every `code` in the file is unique, every
      `gradeLevel` and `subject` is a valid enum member, and every entry has a
      non-empty descriptor. — done, `tests/unit/lib/taxonomy/index.test.ts`,
      which now also asserts every gradable subject yields a non-empty slate at
      every K-8 grade. That last assertion is the one that would have caught the
      original defect.
- [ ] Decide `SKILL_GRADE_BAND` from the first fixture run rather than leaving it
      at the assumed `1`. Now load-bearing in a way it was not before: the banded
      NGSS and C3 standards sit at their band's middle grade and rely on a band
      of at least 1 to be reachable from the band's edges. Lowering it to 0
      silently empties social studies at five of the nine K-8 grades.
- [x] NGSS, if and when science practice becomes a real surface. — done.
- [ ] `FOREIGN_LANGUAGE` has no bundled framework. ACTFL is organised by
      proficiency, not grade; bundling it needs its own ADR deciding that
      mapping. Tracked as an assertion in the taxonomy test.

## Revisit when

A non-Common-Core state framework is needed (CASE becomes worth its cost); or a
measured fixture run shows the model choosing a valid-but-wrong code often enough
to matter (the slate needs narrowing, or a second verification pass); or the
bundled subset grows past what fits comfortably in a prompt; or M7's learner
profile can supply a working level, at which point the slate should be built from
that rather than from the profile's nominal grade.
