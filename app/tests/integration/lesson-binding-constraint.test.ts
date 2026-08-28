import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");

/**
 * M4 AC 5's binding rule, against real Postgres.
 *
 * `Lesson` carries two nullable foreign keys — `extractedProblemId` and
 * `practiceProblemId` — and exactly one must be set. Prisma cannot express
 * that, so the migration is hand-edited to add
 *   CHECK (num_nonnulls("extractedProblemId", "practiceProblemId") = 1)
 * and a reader of `schema.prisma` sees only two independent optional columns.
 * This file is the constraint's documentation, the third instance of the
 * arrangement ADR-0017 established.
 *
 * **It also proves the constraint is LIVE**, not merely present in a migration
 * file. That distinction has caught this project before: a hand-added CHECK
 * that never applied would leave `schema.prisma` looking exactly the same.
 *
 * Both failure directions matter and they fail differently. NEITHER set is a
 * lesson about nothing. BOTH set makes "which problem is this explaining"
 * ambiguous, and AC 21's cascade would then depend on which parent happened to
 * be deleted first.
 */
describe("a lesson is bound to exactly one problem", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function fixture() {
    const user = await db.user.create({
      data: { email: `lesson-binding-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/lesson-${Date.now()}-${Math.random()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalFilename: "x.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });
    const extractedProblem = await db.extractedProblem.create({
      data: { extractionId: extraction.id, ordinal: 1, text: "What is 1/4 + 1/4?", confidence: 0.9 },
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
    const practiceProblem = await db.practiceProblem.create({
      data: { practiceSetId: set.id, ordinal: 1, skillCode: "4.NF.B.3", text: "test", answerFormat: "NUMERIC" },
    });

    return { profile, extractedProblem, practiceProblem };
  }

  const defaults = {
    status: "PENDING" as const,
  };

  it("accepts a lesson bound to an extracted problem", async () => {
    const { profile, extractedProblem } = await fixture();
    const lesson = await db.lesson.create({
      data: { ...defaults, studentProfileId: profile.id, extractedProblemId: extractedProblem.id },
    });
    expect(lesson.practiceProblemId).toBeNull();
  });

  it("accepts a lesson bound to a practice problem", async () => {
    const { profile, practiceProblem } = await fixture();
    const lesson = await db.lesson.create({
      data: { ...defaults, studentProfileId: profile.id, practiceProblemId: practiceProblem.id },
    });
    expect(lesson.extractedProblemId).toBeNull();
  });

  /** A lesson about nothing is the free-explanation surface M4's non-goals forbid. */
  it("rejects a lesson bound to neither", async () => {
    const { profile } = await fixture();
    await expect(db.lesson.create({ data: { ...defaults, studentProfileId: profile.id } })).rejects.toThrow();
  });

  /** Both set makes the AC 21 cascade order-dependent. */
  it("rejects a lesson bound to both", async () => {
    const { profile, extractedProblem, practiceProblem } = await fixture();
    await expect(
      db.lesson.create({
        data: {
          ...defaults,
          studentProfileId: profile.id,
          extractedProblemId: extractedProblem.id,
          practiceProblemId: practiceProblem.id,
        },
      }),
    ).rejects.toThrow();
  });

  /**
   * The constraint must survive an UPDATE too, not only an INSERT. A lesson
   * that starts valid and is later re-pointed at a second problem is the same
   * ambiguity arriving through a different door — and AC 5 says a lesson is
   * never re-pointed.
   */
  it("rejects re-pointing an existing lesson at a second problem", async () => {
    const { profile, extractedProblem, practiceProblem } = await fixture();
    const lesson = await db.lesson.create({
      data: { ...defaults, studentProfileId: profile.id, extractedProblemId: extractedProblem.id },
    });

    await expect(
      db.lesson.update({ where: { id: lesson.id }, data: { practiceProblemId: practiceProblem.id } }),
    ).rejects.toThrow();
  });
});
