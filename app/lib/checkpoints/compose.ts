/**
 * Which skills a checkpoint asks about (spec AC 1-3, plan §3).
 *
 * PURE — no database, no network, no `server-only`. The caller
 * (`lib/checkpoints/generate.ts`, slice 5) reads the mastery rows and passes
 * them in. Same split ADR-0016 uses for `candidateSlate` and for the same
 * reason: a pure module is testable exhaustively, cheap to call, and safe for
 * either track to import.
 *
 * The ordering rule is the whole design. A checkpoint exists to find out what
 * survived, so it asks about the LEAST recently practised skills first —
 * time since practice being the only decay proxy available before M7's
 * scheduler exists. It is a proxy, and the plan records it as one.
 */

import { CHECKPOINT_MIN_SKILLS, CHECKPOINT_SIZE } from "@/lib/config";

/** The subset of a `SkillMastery` row this needs. Any real row satisfies it. */
export type CheckpointCandidate = {
  skillCode: string;
  attemptCount: number;
  lastPracticedAt: Date | null;
};

/**
 * `NOT_ENOUGH_SKILLS` is the only refusal, and it is a normal outcome rather
 * than an error: a student who has practised two skills has nothing to be
 * checked ACROSS yet. The route turns it into AC 4's readiness reason and
 * AC 1's typed refusal, never a 500.
 */
export type CheckpointComposition =
  | { ok: true; skillCodes: string[] }
  | { ok: false; reason: "NOT_ENOUGH_SKILLS"; distinctSkills: number; required: number };

/**
 * AC 2: only skills with at least one recorded attempt. A checkpoint never
 * probes territory the student has not seen — that would be the diagnostic
 * placement test M7's non-goals forbid.
 */
function eligible(candidates: readonly CheckpointCandidate[]): CheckpointCandidate[] {
  const seen = new Set<string>();
  const out: CheckpointCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.attemptCount <= 0) continue;
    // `SkillMastery` is unique on (studentProfileId, skillCode), so a
    // duplicate here means a caller built the list wrongly. Dropping it beats
    // asking the same skill twice for the wrong reason.
    if (seen.has(candidate.skillCode)) continue;
    seen.add(candidate.skillCode);
    out.push(candidate);
  }
  return out;
}

/**
 * AC 3: oldest-practised first. `lastPracticedAt` of `null` sorts first — it
 * should not occur alongside `attemptCount > 0`, but if the two ever disagree
 * the safer reading is "so long ago nothing recorded it".
 *
 * Ties break on `skillCode` so composition is deterministic: two runs over the
 * same rows must produce the same checkpoint, or the tests below assert
 * nothing and a retry could silently change what a student is asked.
 */
function byOldestPractised(a: CheckpointCandidate, b: CheckpointCandidate): number {
  const at = a.lastPracticedAt?.getTime() ?? -Infinity;
  const bt = b.lastPracticedAt?.getTime() ?? -Infinity;
  if (at !== bt) return at - bt;
  return a.skillCode < b.skillCode ? -1 : a.skillCode > b.skillCode ? 1 : 0;
}

/**
 * Composes the ordered skill-code list for one checkpoint.
 *
 * When there are fewer eligible skills than `size`, the list CYCLES in the
 * same order rather than padding with the first skill or shortening the set:
 * every eligible skill is asked once before any is asked twice. A student with
 * three skills and a size of eight gets 1,2,3,1,2,3,1,2 — not 1,1,1,2,2,2,3,3,
 * which would read as a drill on one skill, and not a three-problem checkpoint,
 * which would make the set length depend on history in a way the UI would have
 * to explain.
 */
export function composeCheckpoint(
  candidates: readonly CheckpointCandidate[],
  size: number = CHECKPOINT_SIZE,
  minSkills: number = CHECKPOINT_MIN_SKILLS,
): CheckpointComposition {
  const pool = eligible(candidates).sort(byOldestPractised);

  if (pool.length < minSkills) {
    return { ok: false, reason: "NOT_ENOUGH_SKILLS", distinctSkills: pool.length, required: minSkills };
  }

  const skillCodes: string[] = [];
  for (let i = 0; i < size; i++) {
    skillCodes.push(pool[i % pool.length].skillCode);
  }
  return { ok: true, skillCodes };
}
