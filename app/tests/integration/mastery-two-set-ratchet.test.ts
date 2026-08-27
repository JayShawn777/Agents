import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

// MUST run before `@/lib/db` (or anything importing it) is loaded — see
// `db-test-url.ts`.
configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { applyMastery } = await import("@/lib/mastery/apply");

/**
 * The owner's correction to ADR-0010, exercised end to end against real
 * Postgres — the sibling of `tests/unit/lib/mastery/apply.test.ts`'s pure
 * `levelFor` test, this time through the actual transaction
 * (`applyMastery`), real `Attempt`/`SkillMastery` rows, and the real
 * exactly-once guard.
 *
 * The regression this settles: "five consecutive correct against a
 * six-problem set means one good set carries a skill from nothing to
 * SECURE... permanent, because level is a ratchet." This test builds
 * exactly that scenario — one PracticeSet, five correct attempts on the
 * same skill — and asserts SECURE is NOT reached, then continues the same
 * streak into a SECOND PracticeSet and asserts it reaches SECURE there.
 */
describe("applyMastery — the two-set ratchet, against real Postgres", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function makeFixtures() {
    const user = await db.user.create({
      data: { email: `mastery-ratchet-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4", displayName: "Test Student" },
    });

    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/test-${Date.now()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 100,
        originalFilename: "test.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });

    async function makePracticeSetWithProblem() {
      const set = await db.practiceSet.create({
        data: {
          studentProfileId: profile.id,
          extractionId: extraction.id,
          status: "READY",
          model: "claude-opus-5",
          effort: "high",
          promptVersion: "test",
          taxonomyVersion: "test",
        },
      });
      const problem = await db.practiceProblem.create({
        data: {
          practiceSetId: set.id,
          ordinal: 1,
          skillCode: "4.NF.B.3",
          text: "Test problem",
          answerFormat: "NUMERIC",
        },
      });
      return { set, problem };
    }

    return { profile, makePracticeSetWithProblem };
  }

  it("five consecutive correct attempts within ONE set do not promote the skill to SECURE, and a sixth correct attempt in a SECOND set does", async () => {
    const { profile, makePracticeSetWithProblem } = await makeFixtures();
    const { set: setA, problem: problemA } = await makePracticeSetWithProblem();

    for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber++) {
      await db.$transaction(async (tx) => {
        const attempt = await tx.attempt.create({
          data: {
            practiceProblemId: problemA.id,
            studentProfileId: profile.id,
            attemptNumber,
            submittedAnswer: "1/2",
            result: "CORRECT",
            gradedBy: "NORMALIZER",
          },
        });
        await applyMastery(tx, {
          attemptId: attempt.id,
          studentProfileId: profile.id,
          skillCode: problemA.skillCode,
          practiceSetId: setA.id,
          result: "CORRECT",
          gradedBy: "NORMALIZER",
          postReveal: false,
        });
      });
    }

    const afterFiveInOneSet = await db.skillMastery.findUniqueOrThrow({
      where: { studentProfileId_skillCode: { studentProfileId: profile.id, skillCode: problemA.skillCode } },
    });
    expect(afterFiveInOneSet.consecutiveCorrect).toBe(5);
    expect(afterFiveInOneSet.attemptCount).toBe(5);
    expect(afterFiveInOneSet.correctCount).toBe(5);
    // THE REGRESSION: five in one set must NOT reach SECURE.
    expect(afterFiveInOneSet.level).not.toBe("SECURE");
    expect(afterFiveInOneSet.level).toBe("DEVELOPING");

    // A sixth correct attempt, but in a SECOND, distinct PracticeSet for the
    // SAME skill — the streak now spans two sets.
    const { set: setB, problem: problemB } = await makePracticeSetWithProblem();
    await db.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({
        data: {
          practiceProblemId: problemB.id,
          studentProfileId: profile.id,
          attemptNumber: 1,
          submittedAnswer: "1/2",
          result: "CORRECT",
          gradedBy: "NORMALIZER",
        },
      });
      await applyMastery(tx, {
        attemptId: attempt.id,
        studentProfileId: profile.id,
        skillCode: problemB.skillCode,
        practiceSetId: setB.id,
        result: "CORRECT",
        gradedBy: "NORMALIZER",
        postReveal: false,
      });
    });

    const afterSecondSet = await db.skillMastery.findUniqueOrThrow({
      where: { studentProfileId_skillCode: { studentProfileId: profile.id, skillCode: problemA.skillCode } },
    });
    expect(afterSecondSet.consecutiveCorrect).toBe(6);
    expect(afterSecondSet.level).toBe("SECURE");
  });

  it("level never falls: SECURE followed by five wrong answers stays SECURE (M2 AC 19)", async () => {
    const { profile, makePracticeSetWithProblem } = await makeFixtures();
    const { set, problem } = await makePracticeSetWithProblem();
    const { set: set2, problem: problem2 } = await makePracticeSetWithProblem();

    // Drive it to SECURE the same way as above: 5 in set 1, 1 more in set 2.
    for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber++) {
      await db.$transaction(async (tx) => {
        const attempt = await tx.attempt.create({
          data: {
            practiceProblemId: problem.id,
            studentProfileId: profile.id,
            attemptNumber,
            submittedAnswer: "1/2",
            result: "CORRECT",
            gradedBy: "NORMALIZER",
          },
        });
        await applyMastery(tx, {
          attemptId: attempt.id,
          studentProfileId: profile.id,
          skillCode: problem.skillCode,
          practiceSetId: set.id,
          result: "CORRECT",
          gradedBy: "NORMALIZER",
          postReveal: false,
        });
      });
    }
    await db.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({
        data: {
          practiceProblemId: problem2.id,
          studentProfileId: profile.id,
          attemptNumber: 1,
          submittedAnswer: "1/2",
          result: "CORRECT",
          gradedBy: "NORMALIZER",
        },
      });
      await applyMastery(tx, {
        attemptId: attempt.id,
        studentProfileId: profile.id,
        skillCode: problem2.skillCode,
        practiceSetId: set2.id,
        result: "CORRECT",
        gradedBy: "NORMALIZER",
        postReveal: false,
      });
    });

    const secure = await db.skillMastery.findUniqueOrThrow({
      where: { studentProfileId_skillCode: { studentProfileId: profile.id, skillCode: problem.skillCode } },
    });
    expect(secure.level).toBe("SECURE");

    // Five wrong answers in a row.
    for (let attemptNumber = 2; attemptNumber <= 6; attemptNumber++) {
      await db.$transaction(async (tx) => {
        const attempt = await tx.attempt.create({
          data: {
            practiceProblemId: problem2.id,
            studentProfileId: profile.id,
            attemptNumber,
            submittedAnswer: "wrong",
            result: "INCORRECT",
            gradedBy: "NORMALIZER",
          },
        });
        await applyMastery(tx, {
          attemptId: attempt.id,
          studentProfileId: profile.id,
          skillCode: problem2.skillCode,
          practiceSetId: set2.id,
          result: "INCORRECT",
          gradedBy: "NORMALIZER",
          postReveal: false,
        });
      });
    }

    const stillSecure = await db.skillMastery.findUniqueOrThrow({
      where: { studentProfileId_skillCode: { studentProfileId: profile.id, skillCode: problem.skillCode } },
    });
    expect(stillSecure.consecutiveCorrect).toBe(0);
    expect(stillSecure.level).toBe("SECURE");
  });

  it("exactly-once: calling applyMastery twice for the SAME attempt id does not double-count", async () => {
    const { profile, makePracticeSetWithProblem } = await makeFixtures();
    const { set, problem } = await makePracticeSetWithProblem();

    const attempt = await db.attempt.create({
      data: {
        practiceProblemId: problem.id,
        studentProfileId: profile.id,
        attemptNumber: 1,
        submittedAnswer: "1/2",
        result: "CORRECT",
        gradedBy: "NORMALIZER",
      },
    });

    const applyOnce = () =>
      db.$transaction((tx) =>
        applyMastery(tx, {
          attemptId: attempt.id,
          studentProfileId: profile.id,
          skillCode: problem.skillCode,
          practiceSetId: set.id,
          result: "CORRECT",
          gradedBy: "NORMALIZER",
          postReveal: false,
        }),
      );

    await applyOnce();
    await applyOnce();

    const mastery = await db.skillMastery.findUniqueOrThrow({
      where: { studentProfileId_skillCode: { studentProfileId: profile.id, skillCode: problem.skillCode } },
    });
    expect(mastery.attemptCount).toBe(1);
    expect(mastery.correctCount).toBe(1);
  });

  it("a postReveal attempt stamps appliedToMasteryAt with NO counter change (ADR-0010 §3's exception)", async () => {
    const { profile, makePracticeSetWithProblem } = await makeFixtures();
    const { set, problem } = await makePracticeSetWithProblem();

    const attempt = await db.attempt.create({
      data: {
        practiceProblemId: problem.id,
        studentProfileId: profile.id,
        attemptNumber: 1,
        submittedAnswer: "1/2",
        result: "CORRECT",
        gradedBy: "NORMALIZER",
        revealed: true,
      },
    });

    await db.$transaction((tx) =>
      applyMastery(tx, {
        attemptId: attempt.id,
        studentProfileId: profile.id,
        skillCode: problem.skillCode,
        practiceSetId: set.id,
        result: "CORRECT",
        gradedBy: "NORMALIZER",
        postReveal: true,
      }),
    );

    const mastery = await db.skillMastery.findUnique({
      where: { studentProfileId_skillCode: { studentProfileId: profile.id, skillCode: problem.skillCode } },
    });
    expect(mastery).toBeNull();

    const stamped = await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(stamped.appliedToMasteryAt).not.toBeNull();
  });
});
