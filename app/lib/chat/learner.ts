import "server-only";

import { db } from "@/lib/db";
import type { OutboundLearnerContext } from "@/lib/ai/outbound";
import type { GradeLevel, Subject } from "@/lib/domain/enums";
import { SUBJECT_ORDER } from "@/lib/domain/enums";
import { resolveSkill } from "@/lib/taxonomy";

/**
 * Assembles the `OutboundLearnerContext` that ADR-0012 §2 renders once, at
 * session open, and then stores on the row.
 *
 * This is the ONLY function that turns database rows into the facts a chat
 * prompt describes a student with, and the type it returns is the AC 7 control:
 * `OutboundLearnerContext` has no name, id, avatar or email field, so a
 * `StudentProfile` row cannot travel through it. The profile is read here and
 * deliberately not passed on.
 *
 * `gradeLevel` is a REQUIRED argument rather than something read off the
 * profile inside this function — see the route's 409. A caller that does not
 * have one must not reach this point.
 */
export async function loadLearnerContext(args: {
  studentProfileId: string;
  gradeLevel: GradeLevel;
}): Promise<OutboundLearnerContext> {
  const mastery = await db.skillMastery.findMany({
    where: { studentProfileId: args.studentProfileId },
    // ONLY these two columns. `attemptCount`, `correctCount`,
    // `consecutiveCorrect`, `modelGradedCount` and every timestamp are ratchet
    // inputs and server-only (M2 AC 20), and `lastPracticedAt` in particular is
    // the exact kind of moving value that would break the cached prefix if it
    // ever found its way into the render.
    select: { skillCode: true, level: true },
  });

  const skills = mastery.map((row) => ({ skillCode: row.skillCode, level: row.level }));

  // Subjects are DERIVED from the skills the student actually has mastery rows
  // for, not stored anywhere. Deriving them keeps the two halves of the context
  // from disagreeing — a subject listed with no skills under it reads to the
  // model as a gap in the student rather than a gap in our data.
  //
  // Sorted into `SUBJECT_ORDER` here as well as in the renderer. That is
  // belt-and-braces on purpose: `findMany` has no guaranteed order without an
  // `orderBy`, and byte-stability is the whole cost model.
  const present = new Set<Subject>();
  for (const skill of skills) {
    const resolved = resolveSkill(skill.skillCode);
    if (resolved) present.add(resolved.subject);
  }
  const subjects = SUBJECT_ORDER.filter((subject) => present.has(subject));

  return { gradeLevel: args.gradeLevel, subjects, skills };
}
