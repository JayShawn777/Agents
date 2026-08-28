import "server-only";

import { AnthropicError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Lesson } from "@/lib/generated/prisma/client";
import { getAnthropicClient, MissingAnthropicApiKeyError } from "@/lib/ai/client";
import type { OutboundLearnerFacts } from "@/lib/ai/outbound";
import { LessonScriptSchema } from "@/lib/lessons/script-schema";
import { buildLessonUserPrompt, LESSON_PROMPT_VERSION, LESSON_SYSTEM_PROMPT } from "@/lib/lessons/prompt";
import { deriveTimeline, validateScriptReferences } from "@/lib/lessons/validate";
import { resolveSkill } from "@/lib/taxonomy";
import type { LessonFailureCode } from "@/lib/errors";
import {
  LESSON_AUTHORING_TIMEOUT_MS,
  LESSON_EFFORT,
  LESSON_MODEL,
  LESSON_SCHEMA_VERSION,
} from "@/lib/config";

/**
 * The lesson authoring status machine (M4 AC 1, 2, 6, 10).
 *
 * **Why this is a background job and not an in-request call.** Measured:
 * 12-59 seconds per lesson, p50 35s (`docs/research/m4-authoring-measurement.md`).
 * A child cannot sit on a spinner for a minute, and at 59s a request is close
 * enough to a platform ceiling that the failure mode would be a timeout rather
 * than a slow success. So the route writes the rows, returns `202 PENDING`, and
 * schedules this with `after()` — the third instance of the shape
 * `run-extraction.ts` and `lib/practice/generate.ts` already use.
 *
 * **What the measurement also settled: no job queue.** `after()` runs for the
 * route's configured `maxDuration`, and 59s fits inside that with room. Plan
 * §9.2's expensive branch — "a new dependency, a new approval and a new
 * operational surface" — is not needed.
 *
 * Every failure lands in exactly one of `LESSON_FAILURE_CODES`, checked most
 * specific first, exactly as extraction does it: refusal, then a null parse,
 * then a script that parses but refers to elements nobody drew, then a
 * connection timeout, then any other typed SDK error, then anything else.
 * Nothing here string-matches an exception message, and nothing returns a model
 * id, a provider payload or an exception message to a caller — the internal
 * code is mapped through a fixed allowlist by `lib/lessons/dto.ts` (AC 10).
 */

export type AuthorLessonResult =
  | { status: "READY"; versionId: string; stepCount: number }
  | { status: "FAILED"; failureCode: LessonFailureCode }
  /**
   * Returned when invoked against a version that is no longer `PENDING` —
   * already `AUTHORING` from a racing trigger, or already terminal. Never
   * fabricated into one of the shapes above; a caller that cares re-reads.
   */
  | { status: "SKIPPED" };

/** Runs one authoring attempt end to end for a single `LessonScriptVersion`. */
export async function authorLesson(versionId: string): Promise<AuthorLessonResult> {
  const version = await db.lessonScriptVersion.findUnique({
    where: { id: versionId },
    include: {
      lesson: {
        include: {
          studentProfile: { select: { gradeLevel: true } },
          extractedProblem: { select: { text: true, subject: true } },
          practiceProblem: { select: { text: true, skillCode: true } },
        },
      },
    },
  });
  if (!version) {
    throw new Error(`authorLesson: no LessonScriptVersion row for id "${versionId}".`);
  }
  if (version.status !== "PENDING") {
    return { status: "SKIPPED" };
  }

  const subject = resolveSubject(version.lesson);
  const gradeLevel = version.lesson.studentProfile.gradeLevel;

  // Both are gated at the route (a 409), so reaching here without them is an
  // invariant violation rather than a case to paper over. It is emphatically
  // NOT defaulted: guessing MATH and GRADE_4 is how this project nearly shipped
  // a maths app, and it would put a wrong reading level in front of a child.
  if (subject === null || gradeLevel === null) {
    console.error(
      `authorLesson(${versionId}): missing ${subject === null ? "subject" : "gradeLevel"}, which the route gate should have refused.`,
    );
    return finalizeFailed(version.id, version.lessonId, "INTERNAL");
  }

  await db.$transaction([
    db.lessonScriptVersion.update({ where: { id: version.id }, data: { status: "AUTHORING" } }),
    db.lesson.update({ where: { id: version.lessonId }, data: { status: "AUTHORING" } }),
  ]);

  const facts: OutboundLearnerFacts = { gradeLevel, subject };
  const problemText = version.lesson.extractedProblem?.text ?? version.lesson.practiceProblem?.text ?? "";

  try {
    const response = await getAnthropicClient().messages.parse({
      model: LESSON_MODEL,
      max_tokens: 16000,
      system: LESSON_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildLessonUserPrompt({ problemText, facts }) }],
      output_config: { format: zodOutputFormat(LessonScriptSchema), effort: LESSON_EFFORT },
    });

    // Most specific first: a refusal is a 200 with `stop_reason: 'refusal'`, so
    // it must be read before the content is trusted.
    if (response.stop_reason === "refusal") {
      return finalizeFailed(version.id, version.lessonId, "REFUSED");
    }

    const script = response.parsed_output;
    if (script === null) {
      // AC 2 and AC 3: the model wanted something the closed vocabulary does
      // not have, or could not obey the shape. Zero steps are persisted, which
      // is a non-event rather than a transaction — `script` is simply left null.
      return finalizeFailed(version.id, version.lessonId, "PARSE_FAILED");
    }

    // The check zod cannot do. A script can validate perfectly and still circle
    // an element nobody wrote, which renders as an annotation floating over
    // nothing — AC 3's "blank canvas in front of a child", reached through the
    // one door the schema leaves open.
    const issues = validateScriptReferences(script);
    if (issues.length > 0) {
      console.error(
        `authorLesson(${versionId}): script failed referential validation — ${issues.map((i) => i.code).join(", ")}`,
      );
      return finalizeFailed(version.id, version.lessonId, "INVALID_SCRIPT");
    }

    const { totalDurationMs } = deriveTimeline(script);

    const saved = await db.$transaction(async (tx) => {
      const updated = await tx.lessonScriptVersion.update({
        where: { id: version.id },
        data: {
          status: "READY",
          script,
          schemaVersion: LESSON_SCHEMA_VERSION,
          stepCount: script.steps.length,
          totalDurationMs,
          model: LESSON_MODEL,
          effort: LESSON_EFFORT,
          promptVersion: LESSON_PROMPT_VERSION,
          failureCode: null,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      });
      // AC 19: the repoint is what makes this version current. Any previous
      // version row is untouched and stays playable.
      await tx.lesson.update({
        where: { id: version.lessonId },
        data: { status: "READY", currentVersionId: version.id },
      });
      return updated;
    });

    return { status: "READY", versionId: saved.id, stepCount: script.steps.length };
  } catch (err) {
    const failureCode = classifyFailure(err);
    console.error(`authorLesson(${versionId}) failed`, err);
    return finalizeFailed(version.id, version.lessonId, failureCode);
  }
}

/**
 * AC 6's "the client is never left holding an open request": an `AUTHORING`
 * version whose function was killed before it reached its own `catch` would
 * otherwise be polled forever. Called from the status GET on every read, the
 * same `reapIfStale` arrangement extraction uses — and the reason M4 needs no
 * cron job.
 *
 * The measurement is what sets the deadline honestly: authoring was never
 * observed above 59s, and `LESSON_AUTHORING_TIMEOUT_MS` is twice that.
 */
export async function reapIfStale(lesson: Lesson, now: Date = new Date()): Promise<Lesson> {
  if (lesson.status !== "AUTHORING") return lesson;
  if (now.getTime() < lesson.updatedAt.getTime() + LESSON_AUTHORING_TIMEOUT_MS) return lesson;

  // Guarded by `status: 'AUTHORING'` so this can never clobber a terminal write
  // that landed concurrently — the original function recovering and finishing
  // just before this read must win.
  const claimed = await db.lesson.updateMany({
    where: { id: lesson.id, status: "AUTHORING" },
    data: { status: "FAILED" },
  });

  if (claimed.count === 1) {
    await db.lessonScriptVersion.updateMany({
      where: { lessonId: lesson.id, status: "AUTHORING" },
      data: { status: "FAILED", failureCode: "TIMEOUT" },
    });
  }

  return { ...lesson, status: "FAILED" };
}

/**
 * The subject a lesson is about. From the extracted problem's own recorded
 * subject, or resolved from the practice problem's skill code through the
 * bundled taxonomy.
 *
 * Returns NULL rather than defaulting. `resolveSkill(...)?.subject ?? "MATH"`
 * is a smell this codebase already carries elsewhere and has already been
 * burned by; a lesson authored under the wrong subject would be explained the
 * wrong way to a child.
 */
function resolveSubject(lesson: {
  extractedProblem: { subject: string | null } | null;
  practiceProblem: { skillCode: string } | null;
}): OutboundLearnerFacts["subject"] | null {
  if (lesson.extractedProblem) {
    return (lesson.extractedProblem.subject as OutboundLearnerFacts["subject"] | null) ?? null;
  }
  if (lesson.practiceProblem) {
    return resolveSkill(lesson.practiceProblem.skillCode)?.subject ?? null;
  }
  return null;
}

/**
 * `APIError` extends `AnthropicError`, so checking the base class first would
 * swallow every subclass. Same order and same reasoning as extraction's
 * `classifyFailure`.
 */
function classifyFailure(err: unknown): LessonFailureCode {
  if (err instanceof MissingAnthropicApiKeyError) return "INTERNAL";
  if (err instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (err instanceof AnthropicError) return "UPSTREAM";
  return "INTERNAL";
}

/**
 * Both rows move together. The lesson's status mirrors its current authoring
 * run, so a client polling the lesson never has to reconcile two answers.
 *
 * `script` is left NULL — AC 2's "zero steps persisted", which needs no
 * transaction to get right because there was never anything to roll back.
 */
async function finalizeFailed(
  versionId: string,
  lessonId: string,
  failureCode: LessonFailureCode,
): Promise<AuthorLessonResult> {
  await db.$transaction([
    db.lessonScriptVersion.update({
      where: { id: versionId },
      // `Prisma.DbNull`, not `null`: for a nullable Json column Prisma
      // distinguishes SQL NULL from the JSON value `null`, and plain `null` is
      // a type error rather than a silent difference. The column was never
      // written on this path anyway — this is belt and braces for the
      // regenerate case.
      data: { status: "FAILED", failureCode, script: Prisma.DbNull },
    }),
    db.lesson.update({ where: { id: lessonId }, data: { status: "FAILED" } }),
  ]);
  return { status: "FAILED", failureCode };
}
