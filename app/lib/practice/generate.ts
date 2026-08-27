import "server-only";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { db } from "@/lib/db";
import type { PracticeSet } from "@/lib/generated/prisma/client";
import { getAnthropicClient } from "@/lib/ai/client";
import {
  classifyGenerationFailure,
  finalizeSetFailed,
  finalizeSetSuccess,
  type RunGenerationResult,
} from "@/lib/practice/finalize";
import { buildPracticeGenerationSchema } from "@/lib/ai/practice-schema";
import { PRACTICE_PROMPT_VERSION, PRACTICE_SYSTEM_PROMPT, buildPracticeUserPrompt, type PracticeSourceSlot } from "@/lib/practice/prompt";
import { candidateSlate, isGradableSubject, resolveSkill, type Skill } from "@/lib/taxonomy";
import type { Subject } from "@/lib/domain/enums";
import {
  PRACTICE_EFFORT,
  PRACTICE_GENERATION_TIMEOUT_MS,
  PRACTICE_MODEL,
  PRACTICE_SET_DIFFICULTY_LADDER,
  PRACTICE_SET_SIZE,
  SKILL_GRADE_BAND,
} from "@/lib/config";

/**
 * B28 (plan §5.1). The status machine — deliberately mirroring
 * `lib/extraction/run-extraction.ts` closely (this milestone's brief):
 * refusal, null parse, timeout, typed SDK error, in that order; one terminal
 * transaction; zero partial writes (M2 AC 5); a `reapIfStale` twin for a
 * killed function.
 *
 * DECISION, FLAGGED (an ambiguity the plan and ADR-0009 leave open): how a
 * single generation call's candidate slate is built when the source
 * extraction has MULTIPLE problems that are not all the same subject.
 * ADR-0009 §2 says the slate is built "from the student's gradeLevel and the
 * subject of the source extracted problem" (singular), but M2 AC 1 says a
 * whole confirmed extraction (which may mix subjects) produces one set. This
 * module resolves it by taking the UNION of each gradable subject's slate
 * (deduplicated by code) for the one generation call — every generated
 * problem's `skillCode` is still validated against that same combined slate,
 * so AC 7/AC 8 hold regardless of how many subjects contributed to it. A
 * non-gradable source problem (subject not in `GRADABLE_SUBJECTS`, or no
 * subject at all) is simply excluded from the round-robin of source
 * problems a generated problem can be modelled on; if EVERY source problem
 * is excluded this way (or the student has no `gradeLevel` yet), the set
 * fails cleanly with `SLATE_EMPTY` and zero AI calls, per ADR-0009 §4.
 */

export type { RunGenerationResult };

export async function runPracticeGeneration(practiceSetId: string): Promise<RunGenerationResult> {
  const set = await db.practiceSet.findUnique({
    where: { id: practiceSetId },
    include: {
      studentProfile: { select: { gradeLevel: true } },
      extraction: { include: { problems: { orderBy: { ordinal: "asc" } } } },
    },
  });
  if (!set) {
    throw new Error(`runPracticeGeneration: no PracticeSet row for id "${practiceSetId}".`);
  }
  if (set.status !== "GENERATING") {
    return { status: "SKIPPED" };
  }

  // `generationAttempts` is owned entirely by this function (incremented
  // once per actual run, including a retry) — the retry route
  // (`app/api/practice-sets/[practiceSetId]/retry/route.ts`) only flips the
  // row back to `GENERATING` and reschedules; it never increments this
  // itself, the same division of ownership as `Extraction.attemptCount`
  // and `lib/extraction/run-extraction.ts`.
  await db.practiceSet.update({
    where: { id: practiceSetId },
    data: { startedAt: new Date(), generationAttempts: { increment: 1 } },
  });

  const gradeLevel = set.studentProfile.gradeLevel;
  if (!gradeLevel) {
    // No grade level yet (a profile that hasn't completed its detail step) —
    // there is no band to build a slate from. Refused cleanly, zero AI calls.
    return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
  }

  // ADR-0017: `extraction` is nullable now that a CHECKPOINT holds NULL there,
  // and the database CHECK constraint guarantees a PRACTICE set never does.
  // This function only ever runs for PRACTICE, so reaching here with no
  // extraction means the constraint was bypassed — refused cleanly rather than
  // asserted away with a non-null operator, which would turn an invariant
  // violation into a crash inside a background `after()` callback.
  if (!set.extraction) {
    console.error(`runPracticeGeneration(${practiceSetId}): PRACTICE set with no extraction — CHECK constraint bypassed?`);
    return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
  }

  const gradableProblems = set.extraction.problems.filter(
    (problem): problem is typeof problem & { subject: Subject } =>
      problem.subject !== null && isGradableSubject(problem.subject),
  );
  if (gradableProblems.length === 0) {
    return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
  }

  const distinctSubjects = [...new Set(gradableProblems.map((problem) => problem.subject))];
  const slate = dedupeSkills(
    distinctSubjects.flatMap((subject) => candidateSlate({ subjects: [subject], gradeLevel, bandGrades: SKILL_GRADE_BAND })),
  );
  if (slate.length === 0) {
    return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
  }
  const codes = slate.map((skill) => skill.code) as [string, ...string[]];

  const slots = PRACTICE_SET_DIFFICULTY_LADDER.map((difficultyOffset, index) => {
    const source = gradableProblems[index % gradableProblems.length];
    return {
      sourceExtractedProblemId: source.id,
      sourceText: source.text,
      subject: source.subject,
      difficultyOffset,
    } satisfies PracticeSourceSlot & { sourceExtractedProblemId: string };
  });

  try {
    const client = getAnthropicClient();
    const schema = buildPracticeGenerationSchema(codes, PRACTICE_SET_SIZE);
    const response = await client.messages.parse(
      {
        model: PRACTICE_MODEL,
        max_tokens: 16000,
        system: PRACTICE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPracticeUserPrompt({ gradeLevel, slots, slate }) }],
        output_config: { format: zodOutputFormat(schema), effort: PRACTICE_EFFORT },
      },
      // Per-call override — the shared client (`lib/ai/client.ts`) is
      // constructed with EXTRACTION_TIMEOUT_MS as its default; generation has
      // its own budget.
      { timeout: PRACTICE_GENERATION_TIMEOUT_MS },
    );

    // Checked most specific first (ADR-0005/ADR's shared convention): a
    // refusal is a 200 with `stop_reason: 'refusal'`, checked before
    // `parsed_output` is ever read.
    if (response.stop_reason === "refusal") {
      return await finalizeSetFailed(practiceSetId, "REFUSED");
    }

    const parsed = response.parsed_output;
    if (parsed === null) {
      return await finalizeSetFailed(practiceSetId, "PARSE_FAILED");
    }

    // M2 AC 2 + ADR-0009 §2's "second line" belt-and-braces re-check: a
    // generated problem identical to its source, or carrying a skill code
    // outside the same slate the request was constrained to, fails the
    // WHOLE set rather than being silently dropped (AC 5's "zero problems
    // persisted" invariant — a partial set for reasons the student can't see
    // is exactly what ADR-0009 rejects the free-text alternative for).
    for (const [index, problem] of parsed.problems.entries()) {
      const slot = slots[index];
      if (textsAreEffectivelyIdentical(problem.text, slot.sourceText)) {
        return await finalizeSetFailed(practiceSetId, "PARSE_FAILED");
      }
      if (!resolveSkill(problem.skillCode)) {
        return await finalizeSetFailed(practiceSetId, "PARSE_FAILED");
      }
    }

    return await finalizeSetSuccess(practiceSetId, {
      problems: parsed.problems,
      slots,
      promptVersion: PRACTICE_PROMPT_VERSION,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    });
  } catch (err) {
    const failureCode = classifyGenerationFailure(err);
    console.error(`runPracticeGeneration(${practiceSetId}) failed`, err);
    return await finalizeSetFailed(practiceSetId, failureCode);
  }
}

/**
 * The lazy-reap query mirroring `run-extraction.ts`'s `reapIfStale` — called
 * from the status GET (endpoint 30) so a client polling a `GENERATING` set
 * whose function died mid-flight still always reaches a terminal state.
 */
export async function reapIfStalePracticeSet<T extends PracticeSet>(set: T): Promise<T> {
  if (set.status !== "GENERATING" || set.startedAt === null) {
    return set;
  }
  const deadline = set.startedAt.getTime() + PRACTICE_GENERATION_TIMEOUT_MS + 30_000;
  if (Date.now() < deadline) {
    return set;
  }

  const completedAt = new Date();
  // Guarded by `status: 'GENERATING'` so this can never clobber a terminal
  // write that landed concurrently (the same shape as
  // `lib/extraction/run-extraction.ts`'s `reapIfStale`).
  const result = await db.practiceSet.updateMany({
    where: { id: set.id, status: "GENERATING" },
    data: { status: "FAILED", failureCode: "TIMEOUT", completedAt },
  });
  if (result.count === 0) {
    const fresh = await db.practiceSet.findUniqueOrThrow({ where: { id: set.id } });
    return { ...set, ...fresh };
  }
  return { ...set, status: "FAILED", failureCode: "TIMEOUT", completedAt };
}

// ─────────────────────────── internals ───────────────────────────

function dedupeSkills(skills: readonly Skill[]): Skill[] {
  const seen = new Set<string>();
  const deduped: Skill[] = [];
  for (const skill of skills) {
    if (seen.has(skill.code)) continue;
    seen.add(skill.code);
    deduped.push(skill);
  }
  return deduped;
}

/** M2 AC 2's check: case/whitespace-insensitive identity, catching the "regenerated the worksheet verbatim" failure mode without being defeated by trivial formatting differences. */
function textsAreEffectivelyIdentical(a: string, b: string): boolean {
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  return normalize(a) === normalize(b);
}

