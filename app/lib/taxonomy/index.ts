/**
 * ADR-0009 §1. The bundled, versioned Common Core subset and the closed-slate
 * selection mechanism (§2). PURE — no database, no network, no `server-only`.
 * Both tracks import this: the backend to build a generation candidate slate
 * (`candidateSlate`) and validate a persisted code (`resolveSkill`); the
 * frontend to render `skillDescriptor` (M2 AC 9) without a round trip.
 *
 * DEVIATION FROM ADR-0009, FLAGGED: the ADR says the JSON is "generated once
 * by a committed script from a public CCSS source, and the source URL, the
 * fetch date and the derivation script are recorded in docs/research/." No
 * such script or source-fetch record exists yet — `ccss-k8.json` was hand
 * authored here from well-known, standard CCSS domain/cluster/standard
 * identifiers and paraphrased descriptors, as a representative subset (K-8
 * math plus a small ELA slice) sized per the ADR's own estimate ("a single
 * grade band of one subject is on the order of 30-60 [standards]"). This is
 * sufficient to build and test the M2 machinery against, but it is NOT the
 * ADR's documented derivation process, and two of ADR-0009's own follow-ups
 * are therefore still open and now doubly important:
 *   - "Record the source URL, fetch date and derivation script... in
 *     docs/research/" — not done.
 *   - "Someone must read the Common Core licence and confirm the attribution
 *     obligation, before descriptors ship to a parent." — not done, and this
 *     hand-authored file makes it MORE important to check, not less: the
 *     descriptors here are paraphrases, not a verified reproduction of CCSS's
 *     own licensed text.
 * See this milestone's report for the same note. Replacing this file with a
 * fetched, sourced one is a data-only change — nothing in `lib/practice/**`
 * or the frontend depends on its exact contents, only on the shape below.
 */

import ccssK8 from "./ccss-k8.json";
import type { GradeLevel, Subject } from "@/lib/domain/enums";
import { GRADE_LEVEL_ORDER } from "@/lib/domain/enums";
import { TAXONOMY_VERSION } from "@/lib/config";

export { TAXONOMY_VERSION };

export type Skill = {
  code: string;
  descriptor: string;
  /// ADR-0009 §1: the taxonomy's own type comment restricts this to the two
  /// subjects Common Core actually covers. `GRADABLE_SUBJECTS` (lib/config.ts)
  /// further narrows which of these two are ever generated against (§4:
  /// ELA is bundled but not gradable in M2).
  gradeLevel: GradeLevel;
  subject: Extract<Subject, "MATH" | "ENGLISH_LANGUAGE_ARTS">;
};

const TAXONOMY: readonly Skill[] = ccssK8 as readonly Skill[];

const BY_CODE: ReadonlyMap<string, Skill> = new Map(TAXONOMY.map((skill) => [skill.code, skill]));

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
 * Returns `[]` for a subject the taxonomy does not cover at all (e.g.
 * `SCIENCE` — ADR-0009 §4, NGSS is not bundled) or for a grade level with no
 * numeric position (`ADULT_LEARNER` — this bundle covers K-8 only). Both are
 * the `SLATE_EMPTY` case upstream, refused cleanly rather than graded badly.
 */
export function candidateSlate(args: {
  subjects: readonly Subject[];
  gradeLevel: GradeLevel;
  bandGrades: number;
}): Skill[] {
  const centre = GRADE_INDEX.get(args.gradeLevel);
  if (centre === undefined) return [];

  const subjectSet = new Set(args.subjects);
  const seen = new Set<string>();
  const slate: Skill[] = [];

  for (const skill of TAXONOMY) {
    if (!subjectSet.has(skill.subject)) continue;
    const skillIndex = GRADE_INDEX.get(skill.gradeLevel);
    if (skillIndex === undefined) continue;
    if (Math.abs(skillIndex - centre) > args.bandGrades) continue;
    if (seen.has(skill.code)) continue;
    seen.add(skill.code);
    slate.push(skill);
  }

  return slate;
}
