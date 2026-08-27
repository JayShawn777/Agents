import "server-only";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { db } from "@/lib/db";
import { getAnthropicClient } from "@/lib/ai/client";
import { buildPracticeGenerationSchema } from "@/lib/ai/practice-schema";
import { composeCheckpoint, type CheckpointCandidate } from "@/lib/checkpoints/compose";
import { CHECKPOINT_PROMPT_VERSION, CHECKPOINT_SYSTEM_PROMPT, buildCheckpointUserPrompt } from "@/lib/checkpoints/prompt";
import {
  classifyGenerationFailure,
  finalizeSetFailed,
  finalizeSetSuccess,
  type RunGenerationResult,
} from "@/lib/practice/finalize";
import { resolveSkill, type Skill } from "@/lib/taxonomy";
import { PRACTICE_EFFORT, PRACTICE_GENERATION_TIMEOUT_MS, PRACTICE_MODEL } from "@/lib/config";

export type { RunGenerationResult };

/**
 * Generates the problems for one checkpoint (spec AC 2-3, AC 7-8; plan §3).
 *
 * The sibling of `runPracticeGeneration`, and deliberately a sibling rather
 * than a branch inside it: the two share their terminal writes
 * (`lib/practice/finalize.ts`) and their output schema, and share nothing else.
 * Practice reads an extraction and models each problem on a source problem;
 * a checkpoint reads mastery history and models each problem on a skill.
 * Threading both through one function would mean a parameter that switches
 * every step.
 *
 * Scheduled with `after()` by the create route, exactly as practice generation
 * is, so the caller gets a 202 immediately.
 */
export async function runCheckpointGeneration(practiceSetId: string): Promise<RunGenerationResult> {
  const set = await db.practiceSet.findUnique({
    where: { id: practiceSetId },
    include: { studentProfile: { select: { gradeLevel: true } } },
  });

  // Mirrors `runPracticeGeneration`: a racing trigger, or an already-terminal
  // row, is a no-op rather than a second generation.
  if (!set || set.status !== "GENERATING") {
    return { status: "SKIPPED" };
  }
  if (set.kind !== "CHECKPOINT") {
    // Structurally impossible via the routes; a loud no-op beats generating
    // the wrong shape of set if it ever becomes possible.
    console.error(`runCheckpointGeneration(${practiceSetId}) called against a ${set.kind} set.`);
    return { status: "SKIPPED" };
  }

  await db.practiceSet.update({
    where: { id: practiceSetId },
    data: { startedAt: new Date(), generationAttempts: { increment: 1 } },
  });

  const gradeLevel = set.studentProfile.gradeLevel;
  if (!gradeLevel) {
    return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
  }

  const candidates: CheckpointCandidate[] = await db.skillMastery.findMany({
    where: { studentProfileId: set.studentProfileId },
    select: { skillCode: true, attemptCount: true, lastPracticedAt: true },
  });

  const composition = composeCheckpoint(candidates);
  if (!composition.ok) {
    // AC 1. The route refuses this before creating a set, so reaching it here
    // means the student's history changed underneath a request that had
    // already been accepted — a deletion, most likely.
    return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
  }

  // A composed code that no longer resolves means the taxonomy changed between
  // the practice that earned the mastery row and this checkpoint. Dropping the
  // skill silently would quietly shorten the set, so the whole set fails —
  // the same "no partial set" rule practice generation follows (M2 AC 5).
  const skillsInOrder: Skill[] = [];
  for (const code of composition.skillCodes) {
    const skill = resolveSkill(code);
    if (!skill) {
      console.error(`runCheckpointGeneration(${practiceSetId}): unresolvable skillCode "${code}".`);
      return await finalizeSetFailed(practiceSetId, "SLATE_EMPTY");
    }
    skillsInOrder.push(skill);
  }

  const distinctCodes = [...new Set(skillsInOrder.map((skill) => skill.code))] as [string, ...string[]];

  try {
    const client = getAnthropicClient();
    const schema = buildPracticeGenerationSchema(distinctCodes, skillsInOrder.length);
    const response = await client.messages.parse(
      {
        model: PRACTICE_MODEL,
        max_tokens: 16000,
        system: CHECKPOINT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildCheckpointUserPrompt({ gradeLevel, skillsInOrder }) }],
        output_config: { format: zodOutputFormat(schema), effort: PRACTICE_EFFORT },
      },
      { timeout: PRACTICE_GENERATION_TIMEOUT_MS },
    );

    if (response.stop_reason === "refusal") {
      return await finalizeSetFailed(practiceSetId, "REFUSED");
    }
    const parsed = response.parsed_output;
    if (parsed === null) {
      return await finalizeSetFailed(practiceSetId, "PARSE_FAILED");
    }

    // ADR-0009 §2's belt-and-braces re-check, same as practice generation.
    // There is no "identical to its source" check here — a checkpoint has no
    // source problem to be identical to.
    for (const problem of parsed.problems) {
      if (!resolveSkill(problem.skillCode)) {
        return await finalizeSetFailed(practiceSetId, "PARSE_FAILED");
      }
    }

    return await finalizeSetSuccess(practiceSetId, {
      problems: parsed.problems,
      // A checkpoint models no extracted problem and climbs no ladder: it is
      // pitched at level, by definition (spec's "not hard for its own sake").
      slots: parsed.problems.map(() => ({ sourceExtractedProblemId: null, difficultyOffset: 0 })),
      promptVersion: CHECKPOINT_PROMPT_VERSION,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    });
  } catch (err) {
    const failureCode = classifyGenerationFailure(err);
    console.error(`runCheckpointGeneration(${practiceSetId}) failed`, err);
    return await finalizeSetFailed(practiceSetId, failureCode);
  }
}
