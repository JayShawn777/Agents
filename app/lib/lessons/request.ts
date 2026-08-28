import "server-only";

import { db } from "@/lib/db";
import type { Lesson, LessonScriptVersion } from "@/lib/generated/prisma/client";
import {
  LESSON_SCHEMA_VERSION,
  LESSON_MODEL,
  LESSON_EFFORT,
  LESSON_FLAGS_PER_HOUR,
  LESSONS_PER_HOUR,
  MAX_LESSON_VERSIONS,
} from "@/lib/config";
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
  return countAuthoringRuns(db, studentProfileId).then((count) => count < LESSONS_PER_HOUR);
}

function countAuthoringRuns(client: CapCountClient, studentProfileId: string): Promise<number> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  return client.lessonScriptVersion.count({
    where: { lesson: { studentProfileId }, createdAt: { gte: windowStart } },
  });
}

/** Accepts either the client or a transaction handle — the count is the same query. */
type CapCountClient = {
  lessonScriptVersion: { count: (args: Parameters<typeof db.lessonScriptVersion.count>[0]) => Promise<number> };
};

/**
 * Thrown when the cap is reached INSIDE the creating transaction. Routes turn
 * it into the same 429 step 7 would have returned.
 */
export class AuthoringCapExceededError extends Error {
  constructor() {
    super("Authoring cap reached");
    this.name = "AuthoringCapExceededError";
  }
}

/**
 * True for the two ways a capped request can fail: our own check, and
 * Postgres refusing to serialize two racing creations (P2034). Both mean "too
 * many at once", which is what a 429 says.
 */
export function isAuthoringCapRejection(err: unknown): boolean {
  if (err instanceof AuthoringCapExceededError) return true;
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2034";
}

/**
 * **The cap has to be re-counted inside the transaction that does the insert.**
 *
 * `withinAuthoringCap` runs as step 7, outside any transaction, and the rows
 * that make its count go up are written afterwards by the handler. So N
 * simultaneous requests all read the same pre-insert count, all see room, and
 * all pass — a cap of six admitting a hundred concurrent Opus runs at
 * `effort: "high"`, each 12-59s. Nothing else throttles them: there is no
 * middleware and no IP limiter, and no unique constraint dedupes two lessons
 * for the same problem.
 *
 * Step 7 is kept as the cheap, well-tested rejection that returns a clean 429
 * without opening a transaction. This is the authoritative one.
 */
async function assertWithinAuthoringCap(tx: CapCountClient, studentProfileId: string): Promise<void> {
  if ((await countAuthoringRuns(tx, studentProfileId)) >= LESSONS_PER_HOUR) {
    throw new AuthoringCapExceededError();
  }
}

/**
 * The flag route's step-7 hook. Counted per profile per hour, matching the
 * shape of every other cap in this file.
 */
export async function withinFlagCap(studentProfileId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const count = await db.lessonFlag.count({
    where: { lesson: { studentProfileId }, createdAt: { gte: windowStart } },
  });
  return count < LESSON_FLAGS_PER_HOUR;
}

/**
 * Creates the `Lesson` and its first `LessonScriptVersion`, both `PENDING`, in
 * one transaction. A lesson with no version is a row a client can poll forever.
 */
export async function openLesson(args: {
  studentProfileId: string;
  binding: LessonBinding;
}): Promise<OpenedLesson> {
  return db.$transaction(
    async (tx) => {
      await assertWithinAuthoringCap(tx, args.studentProfileId);

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
    },
    // Serializable, so two racing creations cannot both pass the count above.
    // Postgres aborts the loser with P2034, which the routes map to the same
    // 429 as the cap itself.
    { isolationLevel: "Serializable" },
  );
}

/**
 * AC 19's regeneration: a NEW version at `version + 1`, `PENDING`. The previous
 * version row is untouched and stays playable — `currentVersionId` is only
 * repointed by `authorLesson` once the new run succeeds, so a failed
 * regeneration leaves the student with the lesson they already had rather than
 * with nothing.
 */
export async function openNextVersion(lessonId: string): Promise<LessonScriptVersion> {
  return db.$transaction(
    async (tx) => {
      const lesson = await tx.lesson.findUniqueOrThrow({
        where: { id: lessonId },
        select: { studentProfileId: true },
      });
      await assertWithinAuthoringCap(tx, lesson.studentProfileId);

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
    },
    { isolationLevel: "Serializable" },
  );
}

/** AC 19 has no ceiling as written, and regeneration is the most expensive loop a child can drive. */
export function atVersionCap(versionCount: number): boolean {
  return versionCount >= MAX_LESSON_VERSIONS;
}
