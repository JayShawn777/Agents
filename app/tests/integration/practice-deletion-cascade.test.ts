import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { deleteStudentData } = await import("@/lib/deletion/service");
const { createFakeStorage } = await import("../unit/mocks/fake-storage");

/**
 * M2 AC 25 + ADR-0010 §6, against the real database (no mocks) — the M2
 * sibling of `tests/integration/student-delete-cascade.test.ts`.
 *
 * Two DIFFERENT deletion paths, two DIFFERENT expected outcomes for the
 * SAME `SkillMastery` row:
 *   1. Deleting the EXTRACTION a practice set came from cascades the
 *      practice set, its problems, its answer keys and its attempts — but
 *      leaves `SkillMastery` untouched (ADR-0010 §6: mastery is per
 *      (profile, skill) and accumulates across many worksheets; deleting
 *      one worksheet must not wipe a skill's whole history).
 *   2. Deleting the STUDENT PROFILE (via `deleteStudentData`, the one
 *      function that destroys a student's data, ADR-0007 §4) removes
 *      EVERYTHING, `SkillMastery` included.
 */
describe("M2 practice data — deletion cascades against real Postgres", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function makeFullFixture() {
    const user = await db.user.create({
      data: { email: `practice-cascade-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/cascade-${Date.now()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalFilename: "x.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });
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
      data: { practiceSetId: set.id, ordinal: 1, skillCode: "4.NF.B.3", text: "test", answerFormat: "NUMERIC" },
    });
    await db.practiceAnswerKey.create({
      data: { practiceProblemId: problem.id, canonicalAnswer: "1/2", acceptedForms: [], workedSolution: "step" },
    });
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
    const mastery = await db.skillMastery.create({
      data: { studentProfileId: profile.id, skillCode: "4.NF.B.3", attemptCount: 1, correctCount: 1, consecutiveCorrect: 1 },
    });

    return { user, profile, upload, extraction, set, problem, attempt, mastery };
  }

  it("deleting the EXTRACTION cascades PracticeSet/PracticeProblem/PracticeAnswerKey/Attempt, but SkillMastery survives (ADR-0010 §6)", async () => {
    const fixture = await makeFullFixture();

    await db.extraction.delete({ where: { id: fixture.extraction.id } });

    await expect(db.practiceSet.findUnique({ where: { id: fixture.set.id } })).resolves.toBeNull();
    await expect(db.practiceProblem.findUnique({ where: { id: fixture.problem.id } })).resolves.toBeNull();
    await expect(
      db.practiceAnswerKey.findUnique({ where: { practiceProblemId: fixture.problem.id } }),
    ).resolves.toBeNull();
    await expect(db.attempt.findUnique({ where: { id: fixture.attempt.id } })).resolves.toBeNull();

    // The accepted consequence, stated in ADR-0010 §6: the mastery counters
    // now describe attempts that no longer exist. The row itself survives.
    const survivingMastery = await db.skillMastery.findUnique({ where: { id: fixture.mastery.id } });
    expect(survivingMastery).not.toBeNull();
    expect(survivingMastery?.attemptCount).toBe(1);
  });

  it("deleting the STUDENT PROFILE (deleteStudentData) removes SkillMastery along with everything else", async () => {
    const fixture = await makeFullFixture();
    const storage = createFakeStorage([]);

    const result = await deleteStudentData(fixture.profile.id, "PROFILE_DELETED", storage);
    expect(result.ok).toBe(true);

    await expect(db.studentProfile.findUnique({ where: { id: fixture.profile.id } })).resolves.toBeNull();
    await expect(db.practiceSet.findUnique({ where: { id: fixture.set.id } })).resolves.toBeNull();
    await expect(db.practiceProblem.findUnique({ where: { id: fixture.problem.id } })).resolves.toBeNull();
    await expect(db.attempt.findUnique({ where: { id: fixture.attempt.id } })).resolves.toBeNull();
    await expect(db.skillMastery.findUnique({ where: { id: fixture.mastery.id } })).resolves.toBeNull();
  });
});
