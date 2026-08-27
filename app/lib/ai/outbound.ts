import "server-only";

import type { GradeLevel, MasteryLevel, Subject } from "@/lib/domain/enums";

/**
 * S15 (plan §5.0). `OutboundLearnerFacts` is the type every M2 prompt
 * builder takes to describe a student to the model. It has NO name, id,
 * avatar or email field — structurally, not by convention — so M2 AC 27
 * ("the outbound request contains problem text, subject and grade level,
 * and no display name, avatar id, account email, user id or student profile
 * id") is a property of the type a prompt builder is handed, not a
 * redaction step someone has to remember to run. A function that never
 * receives a `StudentProfile` row cannot leak one.
 */
export type OutboundLearnerFacts = {
  gradeLevel: GradeLevel;
  subject: Subject;
};

/**
 * The learner context M3's chat and M7's summarisation describe a STUDENT
 * with, as opposed to `OutboundLearnerFacts`, which describes the setting of
 * ONE problem. Same structural guarantee: no name, id, avatar or email field
 * exists on it, so M3 AC 7 is a property of the type rather than a redaction
 * step (ADR-0012 §2).
 *
 * DIVERGENCE FROM ADR-0012, recorded deliberately: the ADR says the renderer's
 * input is "the shared `OutboundLearnerFacts` type — grade level, subjects, and
 * a per-skill mastery map". That type is `{ gradeLevel, subject }` — SINGULAR
 * subject, no mastery — because M2's graders describe one problem at a time.
 * Widening it in place would force every M2 grading call site to construct a
 * mastery map it does not use, to satisfy a consumer it does not have. A
 * sibling type keeps both call sites honest and preserves the one property that
 * actually mattered: neither can carry an identifier. M7 widens THIS type.
 *
 * `skills` is a list rather than a map on purpose: a `Record` has no defined
 * key order, and ADR-0012 §2 requires the render to be byte-stable. Sorting a
 * list the renderer already owns is checkable; trusting `Object.keys` over a
 * Prisma result is not.
 */
export type OutboundLearnerContext = {
  gradeLevel: GradeLevel;
  subjects: readonly Subject[];
  skills: readonly { skillCode: string; level: MasteryLevel }[];
};
