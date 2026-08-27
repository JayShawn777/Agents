import "server-only";

import { AnthropicError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";

import { db } from "@/lib/db";
import { MissingAnthropicApiKeyError } from "@/lib/ai/client";
import type { GeneratedPracticeProblem } from "@/lib/ai/practice-schema";
import type { GenerationFailureCode } from "@/lib/errors";

/**
 * The terminal writes shared by every generator that produces
 * `PracticeProblem` rows — practice (`lib/practice/generate.ts`) and
 * checkpoints (`lib/checkpoints/generate.ts`).
 *
 * Extracted rather than copied, and the reason is ADR-0017's own argument: a
 * second answer-key writer is a second chance to leak one. `PracticeAnswerKey`
 * holds the values a child must never be handed early, and the transaction
 * below is the only place in the codebase that inserts them. Duplicating it
 * per generator would mean the M2 review's answer-key findings would have to
 * be re-derived against each copy.
 *
 * These were private to `lib/practice/generate.ts` until M2.5 slice 5b. The
 * only behavioural change is that `sourceExtractedProblemId` may now be null —
 * a checkpoint's problems descend from a skill the student practised, not from
 * any single worksheet. The column has always been nullable.
 */

export type RunGenerationResult =
  | { status: "READY"; problemCount: number }
  | { status: "FAILED"; failureCode: GenerationFailureCode }
  /** Mirrors `run-extraction.ts`'s `SKIPPED` — invoked against a row no longer `GENERATING` (a racing trigger, or already terminal). */
  | { status: "SKIPPED" };

/**
 * The per-problem provenance a generator supplies alongside the model's
 * output, positionally aligned with it.
 */
export type PersistedProblemSlot = {
  /** Null for a checkpoint: it models no single extracted problem. */
  sourceExtractedProblemId: string | null;
  difficultyOffset: number;
};

/** Checked most specific first (research §8): a timeout is a subclass of a connection error, which is a subclass of `APIError`, which is a subclass of `AnthropicError`. */
export function classifyGenerationFailure(err: unknown): GenerationFailureCode {
  if (err instanceof MissingAnthropicApiKeyError) return "INTERNAL";
  if (err instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (err instanceof AnthropicError) return "UPSTREAM";
  return "INTERNAL";
}

export async function finalizeSetFailed(
  practiceSetId: string,
  failureCode: GenerationFailureCode,
): Promise<RunGenerationResult> {
  // AC 5: a FAILED set never has a partial row — this path never touches
  // PracticeProblem/PracticeAnswerKey.
  await db.practiceSet.update({
    where: { id: practiceSetId },
    data: { status: "FAILED", failureCode, completedAt: new Date() },
  });
  return { status: "FAILED", failureCode };
}

export type FinalizeSuccessArgs = {
  problems: readonly GeneratedPracticeProblem[];
  slots: readonly PersistedProblemSlot[];
  /** Recorded on the set so a later prompt change is legible in the data. */
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number };
};

export async function finalizeSetSuccess(
  practiceSetId: string,
  outcome: FinalizeSuccessArgs,
): Promise<RunGenerationResult> {
  const now = new Date();

  // AC 5's "no partial set is written": the terminal write, the
  // PracticeProblem inserts and the PracticeAnswerKey inserts are ONE
  // transaction — there is no code path that writes problems outside it.
  await db.$transaction(async (tx) => {
    await tx.practiceSet.update({
      where: { id: practiceSetId },
      data: {
        status: "READY",
        completedAt: now,
        promptVersion: outcome.promptVersion,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
      },
    });

    const createdProblems = await tx.practiceProblem.createManyAndReturn({
      data: outcome.problems.map((problem, index) => ({
        practiceSetId,
        ordinal: index + 1,
        sourceExtractedProblemId: outcome.slots[index].sourceExtractedProblemId,
        skillCode: problem.skillCode,
        text: problem.text,
        containsMath: problem.containsMath,
        answerFormat: problem.answerFormat,
        choices: problem.choices,
        difficultyOffset: outcome.slots[index].difficultyOffset,
      })),
    });

    // `createManyAndReturn` preserves input order (Prisma 7), so index
    // alignment with `outcome.problems` is exact.
    await tx.practiceAnswerKey.createMany({
      data: createdProblems.map((created, index) => ({
        practiceProblemId: created.id,
        canonicalAnswer: outcome.problems[index].canonicalAnswer,
        acceptedForms: outcome.problems[index].acceptedForms,
        workedSolution: outcome.problems[index].workedSolution,
      })),
    });
  });

  return { status: "READY", problemCount: outcome.problems.length };
}
