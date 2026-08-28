import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { deleteStudentData } = await import("@/lib/deletion/service");
const { createFakeStorage } = await import("../unit/mocks/fake-storage");

/**
 * M4 AC 21, against the real database — and **its own slice, written before the
 * player, per retro lesson 19**.
 *
 * That lesson exists because this exact gap has now been missed three times:
 * ADR-0017's checkpoint cascade was half-tested, M2.5's review added the other
 * half, and M3's AC 16 had no test at all until M3's review. `onDelete: Cascade`
 * is a line in `schema.prisma` that no unit test can reach — none of them touch
 * a foreign key — so every mocked test in the suite passes whether the cascade
 * fires or not.
 *
 * The rule the retro settled on, applied here:
 *
 *   - **Cover every binding.** A lesson hangs off an extracted problem OR a
 *     practice problem, and the one reachable through only one of two optional
 *     foreign keys is the one that gets missed.
 *   - **Assert a COUNT is zero**, not that known ids are gone. A count is the
 *     only form of "is any of this child's data still here" that a future
 *     column, a second binding or a new child table cannot slip past.
 *
 * It matters here for the same reason it mattered for chat: a `LessonFlag` is a
 * child saying "this was wrong", and lessons are generated about that child's
 * own schoolwork.
 */
describe("M4 lesson data — deletion cascades against real Postgres", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function makeFixture() {
    const user = await db.user.create({
      data: { email: `lesson-cascade-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/lesson-cascade-${Date.now()}-${Math.random()}.jpg`,
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
      data: {
        practiceSetId: set.id,
        sourceExtractedProblemId: extractedProblem.id,
        ordinal: 1,
        skillCode: "4.NF.B.3",
        text: "What is 1/2 + 1/4?",
        answerFormat: "NUMERIC",
      },
    });

    // One lesson per binding, each with a version and a flag, so every path
    // below can prove it took the right one and left the other alone.
    const problemLesson = await db.lesson.create({
      data: { studentProfileId: profile.id, extractedProblemId: extractedProblem.id, status: "READY" },
    });
    const practiceLesson = await db.lesson.create({
      data: { studentProfileId: profile.id, practiceProblemId: practiceProblem.id, status: "READY" },
    });

    const versionDefaults = {
      version: 1,
      status: "READY" as const,
      schemaVersion: "1",
      model: "claude-opus-5",
      effort: "high",
      promptVersion: "test",
      stepCount: 3,
    };
    const problemVersion = await db.lessonScriptVersion.create({
      data: { ...versionDefaults, lessonId: problemLesson.id },
    });
    const practiceVersion = await db.lessonScriptVersion.create({
      data: { ...versionDefaults, lessonId: practiceLesson.id },
    });

    const problemFlag = await db.lessonFlag.create({
      data: { lessonId: problemLesson.id, versionId: problemVersion.id, stepIndex: 1, reason: "CONFUSING" },
    });
    const practiceFlag = await db.lessonFlag.create({
      data: { lessonId: practiceLesson.id, versionId: practiceVersion.id, stepIndex: null, reason: "WRONG" },
    });

    return {
      profile,
      extraction,
      extractedProblem,
      practiceProblem,
      problemLesson,
      practiceLesson,
      problemVersion,
      practiceVersion,
      problemFlag,
      practiceFlag,
    };
  }

  /** "Is any of this child's lesson data still here?" — the only form that survives a schema change. */
  async function remainingFor(studentProfileId: string) {
    const [lessons, versions, flags] = await Promise.all([
      db.lesson.count({ where: { studentProfileId } }),
      db.lessonScriptVersion.count({ where: { lesson: { studentProfileId } } }),
      db.lessonFlag.count({ where: { lesson: { studentProfileId } } }),
    ]);
    return { lessons, versions, flags };
  }

  it("deleting the EXTRACTED PROBLEM removes the lesson bound to it, its versions and its flags", async () => {
    const fixture = await makeFixture();

    await db.extractedProblem.delete({ where: { id: fixture.extractedProblem.id } });

    await expect(db.lesson.findUnique({ where: { id: fixture.problemLesson.id } })).resolves.toBeNull();
    await expect(
      db.lessonScriptVersion.findUnique({ where: { id: fixture.problemVersion.id } }),
    ).resolves.toBeNull();
    await expect(db.lessonFlag.findUnique({ where: { id: fixture.problemFlag.id } })).resolves.toBeNull();

    // And it did NOT reach the other binding. `sourceExtractedProblemId` is
    // SetNull, so the practice problem survives its source being deleted — and
    // so must the lesson hanging off it.
    await expect(db.lesson.findUnique({ where: { id: fixture.practiceLesson.id } })).resolves.not.toBeNull();
  });

  /**
   * The binding that gets missed. A lesson bound to a PRACTICE problem has no
   * `extractedProblemId` at all, so any deletion routine that walks uploads and
   * extractions never reaches it — the same construction that hid M2.5's
   * checkpoint cascade and M3's attempt-bound chat sessions.
   */
  it("deleting the PRACTICE PROBLEM removes the lesson bound to it, its versions and its flags", async () => {
    const fixture = await makeFixture();

    await db.practiceProblem.delete({ where: { id: fixture.practiceProblem.id } });

    await expect(db.lesson.findUnique({ where: { id: fixture.practiceLesson.id } })).resolves.toBeNull();
    await expect(
      db.lessonScriptVersion.findUnique({ where: { id: fixture.practiceVersion.id } }),
    ).resolves.toBeNull();
    await expect(db.lessonFlag.findUnique({ where: { id: fixture.practiceFlag.id } })).resolves.toBeNull();

    await expect(db.lesson.findUnique({ where: { id: fixture.problemLesson.id } })).resolves.not.toBeNull();
  });

  /**
   * Deleting the EXTRACTION reaches both bindings by two different routes: the
   * extracted problem directly, and the practice set that cascades to the
   * practice problem. Worth its own case because the two arrive by different
   * paths and only one of them is obvious.
   */
  it("deleting the EXTRACTION removes both lessons, by both routes", async () => {
    const fixture = await makeFixture();

    await db.extraction.delete({ where: { id: fixture.extraction.id } });

    expect(await remainingFor(fixture.profile.id)).toEqual({ lessons: 0, versions: 0, flags: 0 });
  });

  /**
   * The COPPA path (M0 AC 46/48, ADR-0007 §4). Everything goes, under both
   * bindings — including a child's own "this was wrong".
   */
  it("deleting the STUDENT PROFILE removes every lesson, version and flag", async () => {
    const fixture = await makeFixture();
    const storage = createFakeStorage([]);

    const result = await deleteStudentData(fixture.profile.id, "PROFILE_DELETED", storage);
    expect(result.ok).toBe(true);

    await expect(db.studentProfile.findUnique({ where: { id: fixture.profile.id } })).resolves.toBeNull();
    expect(await remainingFor(fixture.profile.id)).toEqual({ lessons: 0, versions: 0, flags: 0 });
  });

  /**
   * The fixture is only evidence if it starts non-empty. A cascade test whose
   * setup silently wrote nothing passes every assertion above for the wrong
   * reason — which is precisely how a cascade goes untested while looking
   * tested.
   */
  it("starts from a fixture that is actually populated", async () => {
    const fixture = await makeFixture();
    expect(await remainingFor(fixture.profile.id)).toEqual({ lessons: 2, versions: 2, flags: 2 });
  });
});
