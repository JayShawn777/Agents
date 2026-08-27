/**
 * ADR-0009 §1. The bundled, versioned standards subset and the closed-slate
 * selection mechanism (§2). PURE — no database, no network, no `server-only`.
 * Both tracks import this: the backend to build a generation candidate slate
 * (`candidateSlate`) and validate a persisted code (`resolveSkill`); the
 * frontend to render `skillDescriptor` (M2 AC 9) without a round trip.
 *
 * ## Coverage
 *
 * The bundle spans four published frameworks, K-8:
 *
 * | Framework | Covers | Codes look like |
 * |---|---|---|
 * | Common Core (CCSS) | `MATH` | `4.NF.B.3` |
 * | Common Core (CCSS) | `ENGLISH_LANGUAGE_ARTS` | `8.RI.2` |
 * | Next Generation Science Standards (NGSS) | `SCIENCE` | `MS-PS1-1` |
 * | College, Career & Civic Life (C3) | `SOCIAL_STUDIES` | `D2.His.1.3-5` |
 *
 * A `Subject` the bundle does not carry — `FOREIGN_LANGUAGE`,
 * `COMPUTER_SCIENCE`, `OTHER` — is NOT gradable, and `GRADABLE_SUBJECTS`
 * below is derived from this coverage rather than hand-maintained. That
 * derivation is the point: the two lists were previously written out
 * separately and had drifted into being almost exactly inverted — `SCIENCE`
 * was declared gradable with no science skill in the bundle (so every science
 * upload passed the gradability filter and then died as `SLATE_EMPTY`), while
 * ELA had 18 usable skills and was filtered out one step earlier. Deriving one
 * from the other makes that class of bug unrepresentable.
 *
 * ## Grade banding
 *
 * CCSS and NGSS K-5 are per-grade and are recorded as written. NGSS middle
 * school (`MS-`) and every C3 standard are published as BANDS (6-8, K-2, 3-5,
 * 6-8) rather than single grades. Each banded standard is placed at its band's
 * middle grade — `GRADE_1`, `GRADE_4`, `GRADE_7` — so that `SKILL_GRADE_BAND`
 * of 1 reaches the whole band from any grade inside it. A code appears exactly
 * once; duplicating it per grade would make `BY_CODE` lossy.
 *
 * ## DEVIATION FROM ADR-0009, FLAGGED
 *
 * The ADR says the JSON is "generated once by a committed script from a public
 * source, and the source URL, the fetch date and the derivation script are
 * recorded in docs/research/." No such script or source-fetch record exists.
 * `skills-k8.json` is hand authored from well-known standard identifiers with
 * PARAPHRASED descriptors, as a representative subset sized per the ADR's own
 * estimate. Sufficient to build and test against; NOT the ADR's documented
 * derivation process. Two ADR-0009 follow-ups stay open and are now wider,
 * because they cover four frameworks rather than one:
 *   - Record each framework's source URL, fetch date and derivation script in
 *     docs/research/ — not done.
 *   - Read each framework's licence and confirm the attribution obligation
 *     before descriptors ship to a parent — not done. CCSS, NGSS and C3 have
 *     DIFFERENT attribution terms; paraphrases are not a verified reproduction
 *     of any of them.
 * Replacing this file with fetched, sourced data is a data-only change —
 * nothing in `lib/practice/**` or the frontend depends on its exact contents,
 * only on the shape below.
 */

import skillsK8 from "./skills-k8.json";
import type { GradeLevel, Subject } from "@/lib/domain/enums";
import { GRADE_LEVEL_ORDER } from "@/lib/domain/enums";
import { TAXONOMY_VERSION } from "@/lib/config";

export { TAXONOMY_VERSION };

/**
 * The subjects the bundle actually carries skills for. A `Subject` outside
 * this union never appears on a `Skill` row.
 */
export type TaxonomySubject = Extract<
  Subject,
  "MATH" | "ENGLISH_LANGUAGE_ARTS" | "SCIENCE" | "SOCIAL_STUDIES"
>;

export type Skill = {
  code: string;
  descriptor: string;
  gradeLevel: GradeLevel;
  subject: TaxonomySubject;
};

/**
 * Which framework's skills a given `Subject` practises against, or `null` for
 * a subject the bundle does not cover.
 *
 * The indirection exists because the `Subject` enum is finer-grained than the
 * frameworks are. A worksheet the extraction model tags `READING` and one it
 * tags `WRITING` are both graded against CCSS ELA; `HISTORY` is graded against
 * C3, which publishes history as one of its four social-studies dimensions.
 * Without this map, a reading comprehension worksheet would resolve to an
 * empty slate and be refused — the same failure that `SCIENCE` used to hit,
 * relocated rather than fixed.
 */
export const SUBJECT_FAMILY: Readonly<Record<Subject, TaxonomySubject | null>> = {
  MATH: "MATH",
  SCIENCE: "SCIENCE",
  ENGLISH_LANGUAGE_ARTS: "ENGLISH_LANGUAGE_ARTS",
  READING: "ENGLISH_LANGUAGE_ARTS",
  WRITING: "ENGLISH_LANGUAGE_ARTS",
  HISTORY: "SOCIAL_STUDIES",
  SOCIAL_STUDIES: "SOCIAL_STUDIES",
  FOREIGN_LANGUAGE: null,
  COMPUTER_SCIENCE: null,
  OTHER: null,
};

const TAXONOMY: readonly Skill[] = skillsK8 as readonly Skill[];

const BY_CODE: ReadonlyMap<string, Skill> = new Map(TAXONOMY.map((skill) => [skill.code, skill]));

/** Every `TaxonomySubject` the loaded bundle has at least one skill for. */
const POPULATED: ReadonlySet<string> = new Set(TAXONOMY.map((skill) => skill.subject));

/**
 * M2 AC 7. Which `Subject`s practice can be generated and auto-graded for —
 * DERIVED from `SUBJECT_FAMILY` and the loaded bundle, never hand-listed, so a
 * subject can only be declared gradable if skills for it actually exist. Adding
 * a framework to `skills-k8.json` and pointing a `Subject` at it in
 * `SUBJECT_FAMILY` is all it takes to make that subject gradable.
 *
 * Previously a hand-written constant in `lib/config.ts`; see the coverage note
 * at the top of this file for what that cost.
 */
export const GRADABLE_SUBJECTS: readonly Subject[] = (
  Object.keys(SUBJECT_FAMILY) as Subject[]
).filter((subject) => {
  const family = SUBJECT_FAMILY[subject];
  return family !== null && POPULATED.has(family);
});

/** `true` if practice can be generated for `subject` at all. */
export function isGradableSubject(subject: Subject): boolean {
  return GRADABLE_SUBJECTS.includes(subject);
}

/** A `GradeLevel` index for band-width arithmetic. `ADULT_LEARNER` has no numeric grade and is handled separately below. */
const GRADE_INDEX: ReadonlyMap<GradeLevel, number> = new Map(
  GRADE_LEVEL_ORDER.filter((level) => level !== "ADULT_LEARNER").map((level, index) => [level, index]),
);

/**
 * AC 7, AC 9. Resolves a persisted `skillCode` to its descriptor and grade
 * level, or `null` for a code the current taxonomy version does not carry
 * (ADR-0009 §3: a retired code never breaks a page — every caller falls back
 * to a neutral label and logs the unresolvable code).
 */
export function resolveSkill(code: string): Skill | null {
  return BY_CODE.get(code) ?? null;
}

/**
 * ADR-0009 §2. The closed slate a generation request is constrained to,
 * resolved BEFORE the model is called from the student's `gradeLevel` and the
 * subject(s) actually being practised, widened by `bandGrades` in both
 * directions. `subjects` accepts more than one because a single practice set
 * can be modelled on several source problems that do not all share a subject
 * (`lib/practice/generate.ts` unions the slates it needs).
 *
 * Each requested `Subject` is resolved through `SUBJECT_FAMILY` first, so
 * `READING` and `WRITING` both draw on the ELA skills and `HISTORY` draws on
 * the social-studies ones.
 *
 * Returns `[]` for a subject the bundle does not cover at all
 * (`FOREIGN_LANGUAGE`, `COMPUTER_SCIENCE`, `OTHER`) or for a grade level with
 * no numeric position (`ADULT_LEARNER` — this bundle covers K-8 only). Both
 * are the `SLATE_EMPTY` case upstream, refused cleanly rather than graded badly.
 */
export function candidateSlate(args: {
  subjects: readonly Subject[];
  gradeLevel: GradeLevel;
  bandGrades: number;
}): Skill[] {
  const centre = GRADE_INDEX.get(args.gradeLevel);
  if (centre === undefined) return [];

  const families = new Set(
    args.subjects.map((subject) => SUBJECT_FAMILY[subject]).filter((family): family is TaxonomySubject => family !== null),
  );
  if (families.size === 0) return [];

  const seen = new Set<string>();
  const slate: Skill[] = [];

  for (const skill of TAXONOMY) {
    if (!families.has(skill.subject)) continue;
    const skillIndex = GRADE_INDEX.get(skill.gradeLevel);
    if (skillIndex === undefined) continue;
    if (Math.abs(skillIndex - centre) > args.bandGrades) continue;
    if (seen.has(skill.code)) continue;
    seen.add(skill.code);
    slate.push(skill);
  }

  return slate;
}
