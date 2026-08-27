import "server-only";

import type { GradeLevel, Subject } from "@/lib/domain/enums";

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
