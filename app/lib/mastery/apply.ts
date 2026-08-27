import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { SkillMastery } from "@/lib/generated/prisma/client";
import type { AttemptResult, GradedBy, MasteryLevel } from "@/lib/domain/enums";
import { LEVELS_BELOW } from "@/lib/domain/enums";
import { MASTERY_LADDER } from "@/lib/config";

/**
 * ADR-0010 §2/§3 (B34) — THE RATCHET, and the owner's two-set correction.
 * **The only module that may write `skillMastery`** — a reviewer grep, the
 * same control ADR-0007 uses for `parentalConsent.update`
 * (`tests/unit/lib/mastery/apply-is-sole-writer.test.ts` greps for it).
 *
 * Called from inside the SAME transaction that creates the graded `Attempt`
 * row (the attempts route, B35) — never on its own, and never twice for the
 * same attempt (see the exactly-once guard below).
 *
 * THE TWO-SET RATCHET (owner's correction to ADR-0010, recorded as a
 * revision note on the ADR itself): the architect's original ladder let
 * `consecutiveCorrect` alone decide the top rung, and because M2's default
 * `PRACTICE_SET_SIZE` (6) is only one more than `SECURE`'s threshold (5), a
 * single well-answered set could carry a skill from `NOT_STARTED` straight
 * to `SECURE` — permanently, because `level` never falls. The fix adds NO
 * new evidence requirement to lower rungs and changes nothing about how
 * counters accumulate; it only requires that by the time a skill reaches the
 * TOP rung, the correct streak has touched a SECOND, distinct `PracticeSet`.
 *
 * `SkillMastery.streakStartPracticeSetId` (a deviation from ADR-0010's
 * original field list, added for this) records which set the CURRENT
 * consecutive-correct streak began in. `spansTwoSets` for a given attempt is
 * then just "does the streak's start differ from the set THIS attempt
 * belongs to" — true the moment a streak that started in one set gets even
 * one more correct answer in a different set, and reset to `null` (alongside
 * `consecutiveCorrect`) the moment a wrong answer breaks the streak.
 *
 * Concurrency note (documented rather than solved, matching this codebase's
 * existing accepted-risk pattern for `lib/uploads/rate-limit.ts`'s
 * count-then-create race): `consecutiveCorrect` and `streakStartPracticeSetId`
 * are computed from a read earlier in the SAME transaction, not from an
 * atomic `increment`/guarded write the way `attemptCount`/`correctCount`/
 * `modelGradedCount`/`level` are. Two attempts on the SAME skill landing in
 * overlapping transactions could, in principle, race each other on these two
 * fields. This is the same order of risk as the existing rate limiters (a
 * single child submits one answer at a time, waiting for the response before
 * the next), and is far less costly than TWO writers is elsewhere in this
 * app: the failure mode is "the streak briefly undercounts by one," never a
 * level moving down, since the ratchet's guarded write is what actually
 * governs `level`.
 */

export type ApplyMasteryArgs = {
  attemptId: string;
  studentProfileId: string;
  skillCode: string;
  practiceSetId: string;
  result: AttemptResult;
  gradedBy: GradedBy;
  /**
   * ADR-0010 §3's deliberate exception (M2 AC 12): an attempt submitted
   * AFTER the worked answer has already been revealed on this problem.
   * `Attempt.appliedToMasteryAt` is still stamped (so a later call is a
   * guaranteed no-op), but NO counter moves at all — typing back an answer
   * you were just shown is not evidence, and crediting it would corrupt the
   * one number a future parent report would rest on.
   */
  postReveal: boolean;
};

export async function applyMastery(tx: Prisma.TransactionClient, args: ApplyMasteryArgs): Promise<SkillMastery | null> {
  const now = new Date();

  // Exactly once (ADR-0010 §3 / M7 AC 14's forward-compatible mechanism):
  // a guarded stamp on the ATTEMPT row itself. A second call for the same
  // attempt (there should never be one in M2 — each submission creates a
  // brand-new Attempt row) matches zero rows and is abandoned before any
  // counter is touched.
  const claimed = await tx.attempt.updateMany({
    where: { id: args.attemptId, appliedToMasteryAt: null },
    data: { appliedToMasteryAt: now },
  });
  if (claimed.count === 0) {
    return tx.skillMastery.findUnique({
      where: { studentProfileId_skillCode: { studentProfileId: args.studentProfileId, skillCode: args.skillCode } },
    });
  }

  if (args.postReveal) {
    return tx.skillMastery.findUnique({
      where: { studentProfileId_skillCode: { studentProfileId: args.studentProfileId, skillCode: args.skillCode } },
    });
  }

  const uniqueKey = { studentProfileId_skillCode: { studentProfileId: args.studentProfileId, skillCode: args.skillCode } };
  const current = await tx.skillMastery.findUnique({ where: uniqueKey });

  const priorConsecutiveCorrect = current?.consecutiveCorrect ?? 0;
  const priorStreakStart = current?.streakStartPracticeSetId ?? null;

  // ADR-0011 §3: an UNSCORED attempt is not evidence in either direction —
  // consecutiveCorrect and the streak's start are left UNCHANGED, never reset.
  const newConsecutiveCorrect =
    args.result === "CORRECT" ? priorConsecutiveCorrect + 1 : args.result === "INCORRECT" ? 0 : priorConsecutiveCorrect;

  const newStreakStart: string | null =
    args.result === "CORRECT"
      ? (priorConsecutiveCorrect === 0 ? args.practiceSetId : priorStreakStart)
      : args.result === "INCORRECT"
        ? null
        : priorStreakStart;

  // The whole of the two-set requirement: true once a streak that began in
  // one set has picked up a correct answer in a DIFFERENT one.
  const spansTwoSets = newStreakStart !== null && newStreakStart !== args.practiceSetId;

  const candidateLevel = levelFor(newConsecutiveCorrect, spansTwoSets);

  await tx.skillMastery.upsert({
    where: uniqueKey,
    create: {
      studentProfileId: args.studentProfileId,
      skillCode: args.skillCode,
      attemptCount: 1,
      correctCount: args.result === "CORRECT" ? 1 : 0,
      consecutiveCorrect: newConsecutiveCorrect,
      streakStartPracticeSetId: newStreakStart,
      modelGradedCount: args.gradedBy === "MODEL" ? 1 : 0,
      level: candidateLevel,
      levelReachedAt: candidateLevel !== "NOT_STARTED" ? now : null,
      lastPracticedAt: now,
    },
    update: {
      attemptCount: { increment: 1 },
      correctCount: { increment: args.result === "CORRECT" ? 1 : 0 },
      consecutiveCorrect: { set: newConsecutiveCorrect },
      streakStartPracticeSetId: { set: newStreakStart },
      modelGradedCount: { increment: args.gradedBy === "MODEL" ? 1 : 0 },
      lastPracticedAt: now,
    },
  });

  // The ratchet (ADR-0010 §2), expressed as a guarded write rather than a
  // read-then-compare: a concurrent write that already raised the level
  // makes this match zero rows, which is a no-op — `max(stored, candidate)`
  // without a read-modify-write race on `level` itself.
  await tx.skillMastery.updateMany({
    where: { studentProfileId: args.studentProfileId, skillCode: args.skillCode, level: { in: [...LEVELS_BELOW[candidateLevel]] } },
    data: { level: candidateLevel, levelReachedAt: now },
  });

  return tx.skillMastery.findUnique({ where: uniqueKey });
}

/**
 * `levelFor` picks the HIGHEST rung in `MASTERY_LADDER` whose threshold is
 * `<= consecutiveCorrect` — EXCEPT a rung marked
 * `requiresMultiplePracticeSets` is skipped entirely unless `spansTwoSets`
 * is true, which is the two-set correction's entire enforcement point.
 */
function levelFor(consecutiveCorrect: number, spansTwoSets: boolean): MasteryLevel {
  let level: MasteryLevel = "NOT_STARTED";
  for (const rung of MASTERY_LADDER) {
    if (consecutiveCorrect < rung.threshold) continue;
    if (rung.requiresMultiplePracticeSets && !spansTwoSets) continue;
    level = rung.level;
  }
  return level;
}

// Exported for the boundary test (`tests/unit/lib/mastery/apply.test.ts`) —
// the ladder's own logic deserves a direct unit test independent of the
// transaction plumbing above.
export const __private = { levelFor };
