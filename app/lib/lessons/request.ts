import "server-only";

import { db } from "@/lib/db";
import type { Lesson, LessonScriptVersion } from "@/lib/generated/prisma/client";
import { LESSON_SCHEMA_VERSION, LESSON_MODEL, LESSON_EFFORT, LESSONS_PER_HOUR, MAX_LESSON_VERSIONS } from "@/lib/config";
import { LESSON_PROMPT_VERSION } from "@/lib/lessons/prompt";

/**
 * Opening a lesson (endpoints 40, 41 and 43 all land here), and the AC 5 gate.
 *
 * The row is written BEFORE any AI call, exactly as M2's practice generation
 * does: it is the rate-limit grant, and it is what makes `202 PENDING` an
 * honest answer rather than a promise. Authoring is scheduled by the caller
 * with `after()`.
 */

export type OpenedLesson = { lesson: Lesson; version: LessonScriptVersion };

export type LessonBinding =
  | { kind: "EXTRACTED_PROBLEM"; extractedProblemId: string }
  | { kind: "PRACTICE_PROBLEM"; practiceProblemId: string };

/**
 * **AC 5, and the reason it exists.** A lesson may only be requested for a
 * problem the student has actually engaged with — an M2 attempt or an M3 chat
 * session. Without it "explain this to me" is available on every problem on the
 * page the moment it is uploaded, which is a do-my-homework machine with extra
 * steps, and the spec names that as the failure mode the milestone must avoid.
 *
 * "Engaged with" is read generously on purpose. For an EXTRACTED problem the
 * student never attempts the row itself — M1 extracts it, M2 generates practice
 * *from* it — so an attempt on any practice problem derived from it counts, as
 * does a chat session bound to it. Requiring an attempt on the extracted row
 * would make the gate unsatisfiable rather than strict.
 *
 * **This gate is enforced but unvalidated**, and the plan says so: nobody has
 * checked whether it is the RIGHT gate or merely a plausible one. It is the
 * first thing to revisit if lessons turn out to be reachable too easily, or not
 * easily enough.
 */
export async function hasEngagedWithProblem(binding: LessonBinding): Promise<boolean> {
  if (binding.kind === "PRACTICE_PROBLEM") {
    const [attempts, sessions] = await Promise.all([
      db.attempt.count({ where: { practiceProblemId: binding.practiceProblemId } }),
      // A chat session binds to an ATTEMPT, not to the practice problem, so the
      // session check has to go through the attempt to reach the problem.
      db.chatSession.count({ where: { attempt: { practiceProblemId: binding.practiceProblemId } } }),
    ]);
    return attempts > 0 || sessions > 0;
  }

  const [attempts, sessions] = await Promise.all([
    db.attempt.count({
      where: { practiceProblem: { sourceExtractedProblemId: binding.extractedProblemId } },
    }),
    db.chatSession.count({ where: { extractedProblemId: binding.extractedProblemId } }),
  ]);
  return attempts > 0 || sessions > 0;
}

/**
 * AC 22's cap, shared by all three routes that can trigger authoring so they
 * cannot drift into different ceilings.
 *
 * **Counted over VERSIONS, not lessons, and that distinction is the point.** A
 * version IS one authoring run — the thing that costs 12-59 seconds and up to
 * 4,569 output tokens. Counting lessons would leave regeneration (endpoint 43)
 * entirely uncapped per hour: `MAX_LESSON_VERSIONS` bounds one lesson at five,
 * but nothing would bound a child pressing "explain it differently" across
 * lesson after lesson. Counting the runs closes both doors with one rule.
 */
export async function withinAuthoringCap(studentProfileId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const count = await db.lessonScriptVersion.count({
    where: { lesson: { studentProfileId }, createdAt: { gte: windowStart } },
  });
  return count < LESSONS_PER_HOUR;
}

/**
 * Creates the `Lesson` and its first `LessonScriptVersion`, both `PENDING`, in
 * one transaction. A lesson with no version is a row a client can poll forever.
 */
export async function openLesson(args: {
  studentProfileId: string;
  binding: LessonBinding;
}): Promise<OpenedLesson> {
  return db.$transaction(async (tx) => {
    const lesson = await tx.lesson.create({
      data: {
        studentProfileId: args.studentProfileId,
        ...(args.binding.kind === "EXTRACTED_PROBLEM"
          ? { extractedProblemId: args.binding.extractedProblemId }
          : { practiceProblemId: args.binding.practiceProblemId }),
        status: "PENDING",
      },
    });

    const version = await tx.lessonScriptVersion.create({
      data: {
        lessonId: lesson.id,
        version: 1,
        status: "PENDING",
        schemaVersion: LESSON_SCHEMA_VERSION,
        // Stamped now so a row is interpretable even if authoring never runs —
        // "which model was this asked of" has an answer from the first moment.
        model: LESSON_MODEL,
        effort: LESSON_EFFORT,
        promptVersion: LESSON_PROMPT_VERSION,
      },
    });

    return { lesson, version };
  });
}

/**
 * AC 19's regeneration: a NEW version at `version + 1`, `PENDING`. The previous
 * version row is untouched and stays playable — `currentVersionId` is only
 * repointed by `authorLesson` once the new run succeeds, so a failed
 * regeneration leaves the student with the lesson they already had rather than
 * with nothing.
 */
export async function openNextVersion(lessonId: string): Promise<LessonScriptVersion> {
  return db.$transaction(async (tx) => {
    const highest = await tx.lessonScriptVersion.aggregate({
      where: { lessonId },
      _max: { version: true },
    });

    const version = await tx.lessonScriptVersion.create({
      data: {
        lessonId,
        version: (highest._max.version ?? 0) + 1,
        status: "PENDING",
        schemaVersion: LESSON_SCHEMA_VERSION,
        model: LESSON_MODEL,
        effort: LESSON_EFFORT,
        promptVersion: LESSON_PROMPT_VERSION,
      },
    });

    // The lesson goes back to PENDING so a poller follows the new run. Its
    // `currentVersionId` is deliberately LEFT ALONE: until the new version is
    // READY, the old one is still the one worth playing.
    await tx.lesson.update({ where: { id: lessonId }, data: { status: "PENDING" } });

    return version;
  });
}

/** AC 19 has no ceiling as written, and regeneration is the most expensive loop a child can drive. */
export function atVersionCap(versionCount: number): boolean {
  return versionCount >= MAX_LESSON_VERSIONS;
}
