import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { deleteStudentData } = await import("@/lib/deletion/service");
const { purgeUnreferencedNarration } = await import("@/lib/narration/purge");
const { createFakeStorage } = await import("../unit/mocks/fake-storage");
const { NARRATION_MODEL_ID, CUE_FORMAT_VERSION } = await import("@/lib/config");

/**
 * M5 §7.3, retro lesson 19 — its own slice, written before the player. This
 * project has now shipped an unproven `onDelete: Cascade` four times
 * (ADR-0017's checkpoint cascade, M2.5's practice cascade, M3's chat
 * cascade, M4's lesson cascade) — each one invisible to the unit suite
 * because none of it touches a real foreign key. The rule the retro
 * settled on, applied here:
 *
 *   - **Cover every binding.** `LessonNarration` cascades from `Lesson`,
 *     which is bound to exactly one of an `ExtractedProblem` or a
 *     `PracticeProblem` — the path reachable through only one of the two is
 *     the one that gets missed.
 *   - **Assert a COUNT is zero**, not that known ids are gone. A count is
 *     the only form of "is any of this child's narration data still here"
 *     that a future column, a second binding or a new child table cannot
 *     slip past.
 *
 * ## The tension this file exists to state plainly (coordinator's note)
 *
 * `NarrationAsset` is keyed to the STUDENT PROFILE, not to a lesson —
 * deliberately, so a second lesson can reuse a cached line (ADR-0015). That
 * means:
 *
 *   - Deleting ONE lesson must NOT delete an asset another lesson still
 *     references — the schema enforces this by construction, because
 *     `NarrationAsset` has no foreign key to `Lesson` at all, only to
 *     `StudentProfile`. A lesson deletion cascades `LessonNarration` and
 *     `LessonNarrationStep` (the join), never `NarrationAsset` itself.
 *   - Deleting the PROFILE must remove every `NarrationAsset` it owns,
 *     shared or not — and it does, via `onDelete: Cascade` from
 *     `StudentProfile`.
 *
 * These two requirements pull in opposite directions on the SAME model, and
 * the schema resolves it by giving `NarrationAsset` no opinion about
 * lessons at all: a lesson-scoped delete leaves it an ordinary row with
 * (possibly) zero referencing steps, and `purgeUnreferencedNarration`
 * (`lib/narration/purge.ts`) is the explicit, idempotent sweep that cleans
 * up the zero-reference case — never a second FK, and never automatic on a
 * lesson delete. This file tests both halves: the automatic cascade (the
 * join rows) AND the fact that a SHARED asset survives a single lesson's
 * deletion while purge still reclaims a lesson-only asset.
 *
 * ## Store/database agreement (coordinator's note)
 *
 * `lib/jobs/reconcile-blobs.ts`'s orphan test is "does any `BLOB_CLAIMANTS`
 * entry claim this pathname" — i.e. does a `NarrationAsset` ROW still exist
 * for it. `purgeUnreferencedNarration` always deletes the blob BEFORE the
 * row (ADR-0007 §1), so at every point observable from outside this
 * function, a pathname with no `NarrationAsset` row also has no object in
 * the store — the two can never disagree in the direction that matters
 * (a live blob with no row, invisible to reconcile-blobs, IS the orphan
 * class reconcile-blobs is built to catch; this function's ordering never
 * produces a row with no blob, which would be the dangerous direction).
 */
describe("M5 narration data — deletion cascades against real Postgres", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function makeFixture() {
    const user = await db.user.create({
      data: { email: `narration-cascade-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/narration-cascade-${Date.now()}-${Math.random()}.jpg`,
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
    const attempt = await db.attempt.create({
      data: {
        practiceProblemId: practiceProblem.id,
        studentProfileId: profile.id,
        attemptNumber: 1,
        submittedAnswer: "3/4",
        result: "CORRECT",
        gradedBy: "NORMALIZER",
      },
    });

    // One lesson per binding, matching tests/integration/lesson-deletion-cascade.test.ts.
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
      stepCount: 2,
    };
    const problemVersion = await db.lessonScriptVersion.create({
      data: { ...versionDefaults, lessonId: problemLesson.id },
    });
    const practiceVersion = await db.lessonScriptVersion.create({
      data: { ...versionDefaults, lessonId: practiceLesson.id },
    });

    // A SHARED cache line — the same narrated sentence, referenced by BOTH
    // lessons' step 0. This is the tension the docstring above states: one
    // lesson dying must not take an asset the other still uses.
    const sharedAsset = await db.narrationAsset.create({
      data: {
        studentProfileId: profile.id,
        cacheKey: `shared-${Date.now()}-${Math.random()}`,
        providerVoiceId: "voice_shared",
        ttsModelId: NARRATION_MODEL_ID,
        pathname: `students/${profile.id}/narration/shared-${Date.now()}-${Math.random()}.mp3`,
        contentType: "audio/mpeg",
        sizeBytes: 1000,
        durationMs: 1500,
        characterCount: 20,
        cues: [],
        cueFormatVersion: CUE_FORMAT_VERSION,
      },
    });
    // An asset referenced ONLY by the problem lesson — the one purge should reclaim once that lesson is gone.
    const problemOnlyAsset = await db.narrationAsset.create({
      data: {
        studentProfileId: profile.id,
        cacheKey: `problem-only-${Date.now()}-${Math.random()}`,
        providerVoiceId: "voice_problem",
        ttsModelId: NARRATION_MODEL_ID,
        pathname: `students/${profile.id}/narration/problem-only-${Date.now()}-${Math.random()}.mp3`,
        contentType: "audio/mpeg",
        sizeBytes: 900,
        durationMs: 1200,
        characterCount: 18,
        cues: [],
        cueFormatVersion: CUE_FORMAT_VERSION,
      },
    });

    const narrationDefaults = {
      studentProfileId: profile.id,
      status: "READY" as const,
      ttsModelId: NARRATION_MODEL_ID,
      providerVoiceId: "voice_shared",
      cueFormatVersion: CUE_FORMAT_VERSION,
      stepCount: 2,
    };
    const problemNarration = await db.lessonNarration.create({
      data: { ...narrationDefaults, lessonId: problemLesson.id, versionId: problemVersion.id },
    });
    const practiceNarration = await db.lessonNarration.create({
      data: { ...narrationDefaults, lessonId: practiceLesson.id, versionId: practiceVersion.id },
    });

    const problemStep0 = await db.lessonNarrationStep.create({
      data: {
        narrationId: problemNarration.id,
        stepId: "step-0",
        stepIndex: 0,
        assetId: sharedAsset.id,
        startOffsetMs: 0,
      },
    });
    const problemStep1 = await db.lessonNarrationStep.create({
      data: {
        narrationId: problemNarration.id,
        stepId: "step-1",
        stepIndex: 1,
        assetId: problemOnlyAsset.id,
        startOffsetMs: 1500,
      },
    });
    const practiceStep0 = await db.lessonNarrationStep.create({
      data: {
        narrationId: practiceNarration.id,
        stepId: "step-0",
        stepIndex: 0,
        assetId: sharedAsset.id,
        startOffsetMs: 0,
      },
    });

    return {
      profile,
      upload,
      extraction,
      extractedProblem,
      practiceProblem,
      attempt,
      problemLesson,
      practiceLesson,
      problemVersion,
      practiceVersion,
      sharedAsset,
      problemOnlyAsset,
      problemNarration,
      practiceNarration,
      problemStep0,
      problemStep1,
      practiceStep0,
    };
  }

  /** "Is any of this child's narration data still here?" — the only form that survives a schema change. */
  async function remainingFor(studentProfileId: string) {
    const [narrations, steps, assets] = await Promise.all([
      db.lessonNarration.count({ where: { studentProfileId } }),
      db.lessonNarrationStep.count({ where: { narration: { studentProfileId } } }),
      db.narrationAsset.count({ where: { studentProfileId } }),
    ]);
    return { narrations, steps, assets };
  }

  it("starts from a fixture that is actually populated", async () => {
    const fixture = await makeFixture();
    expect(await remainingFor(fixture.profile.id)).toEqual({ narrations: 2, steps: 3, assets: 2 });
  });

  it("deleting the LESSON directly removes its LessonNarration and LessonNarrationStep rows, but leaves NarrationAsset rows (including the shared one) untouched until purge runs", async () => {
    const fixture = await makeFixture();

    await db.lesson.delete({ where: { id: fixture.problemLesson.id } });

    await expect(
      db.lessonNarration.findUnique({ where: { id: fixture.problemNarration.id } }),
    ).resolves.toBeNull();
    expect(
      await db.lessonNarrationStep.count({ where: { narrationId: fixture.problemNarration.id } }),
    ).toBe(0);
    // The other lesson's narration is untouched.
    await expect(
      db.lessonNarration.findUnique({ where: { id: fixture.practiceNarration.id } }),
    ).resolves.not.toBeNull();

    // NarrationAsset never cascades from Lesson — both assets still exist
    // right after the raw delete, including the one now fully unreferenced.
    expect(await db.narrationAsset.count({ where: { studentProfileId: fixture.profile.id } })).toBe(2);

    // The explicit sweep (called by lib/uploads/delete-upload.ts and, per
    // this task's report, still needing to be wired into the
    // extracted-problem DELETE route) reclaims exactly the unreferenced one.
    const storage = createFakeStorage([]);
    const result = await purgeUnreferencedNarration(fixture.profile.id, storage);

    expect(result).toEqual({ deleted: 1 });
    expect(storage.deletedBatches).toEqual([[fixture.problemOnlyAsset.pathname]]);
    await expect(
      db.narrationAsset.findUnique({ where: { id: fixture.problemOnlyAsset.id } }),
    ).resolves.toBeNull();
    // The SHARED asset survives — the practice lesson's step 0 still points at it.
    await expect(
      db.narrationAsset.findUnique({ where: { id: fixture.sharedAsset.id } }),
    ).resolves.not.toBeNull();
  });

  it("deleting the EXTRACTED PROBLEM cascades through the lesson bound to it and removes its narration rows only", async () => {
    const fixture = await makeFixture();

    await db.extractedProblem.delete({ where: { id: fixture.extractedProblem.id } });

    await expect(
      db.lessonNarration.findUnique({ where: { id: fixture.problemNarration.id } }),
    ).resolves.toBeNull();
    expect(
      await db.lessonNarrationStep.count({ where: { narrationId: fixture.problemNarration.id } }),
    ).toBe(0);
    await expect(
      db.lessonNarration.findUnique({ where: { id: fixture.practiceNarration.id } }),
    ).resolves.not.toBeNull();
    // Untouched by a bare FK cascade — only purge (tested above) reclaims it.
    expect(await db.narrationAsset.count({ where: { studentProfileId: fixture.profile.id } })).toBe(2);
  });

  it("deleting the PRACTICE PROBLEM cascades through the lesson bound to it and removes its narration rows only", async () => {
    const fixture = await makeFixture();

    await db.practiceProblem.delete({ where: { id: fixture.practiceProblem.id } });

    await expect(
      db.lessonNarration.findUnique({ where: { id: fixture.practiceNarration.id } }),
    ).resolves.toBeNull();
    expect(
      await db.lessonNarrationStep.count({ where: { narrationId: fixture.practiceNarration.id } }),
    ).toBe(0);
    await expect(
      db.lessonNarration.findUnique({ where: { id: fixture.problemNarration.id } }),
    ).resolves.not.toBeNull();
  });

  /**
   * The negative case. `Attempt` has NO foreign key to `Lesson`,
   * `LessonNarration` or `NarrationAsset` anywhere in `schema.prisma` — it is
   * bound to a `PracticeProblem` and cascades the OTHER direction (deleting
   * the practice problem takes the attempt, never the reverse). This is
   * still worth asserting directly: it is exactly the kind of one-directional
   * FK that a future schema edit could silently reverse, and a count taken
   * before and after is what would catch that.
   */
  it("deleting the ATTEMPT reaches no narration data — it has no path to Lesson or NarrationAsset", async () => {
    const fixture = await makeFixture();
    const before = await remainingFor(fixture.profile.id);

    await db.attempt.delete({ where: { id: fixture.attempt.id } });

    expect(await remainingFor(fixture.profile.id)).toEqual(before);
    await expect(db.lesson.findUnique({ where: { id: fixture.practiceLesson.id } })).resolves.not.toBeNull();
  });

  /**
   * The COPPA path (M0 AC 46/48, AC 20, ADR-0007 §4). Deleting the whole
   * profile must remove EVERY NarrationAsset it owns — shared or not — via
   * `onDelete: Cascade` from `StudentProfile`, and must delete the
   * underlying blobs (never just the rows) before doing it.
   */
  it("deleteStudentData removes every LessonNarration, LessonNarrationStep and NarrationAsset row, and deletes their blobs", async () => {
    const fixture = await makeFixture();
    const storage = createFakeStorage([]);

    const result = await deleteStudentData(fixture.profile.id, "PROFILE_DELETED", storage);
    expect(result.ok).toBe(true);

    await expect(db.studentProfile.findUnique({ where: { id: fixture.profile.id } })).resolves.toBeNull();
    expect(await remainingFor(fixture.profile.id)).toEqual({ narrations: 0, steps: 0, assets: 0 });

    const deletedPathnames = new Set(storage.deletedBatches.flat());
    expect(deletedPathnames.has(fixture.sharedAsset.pathname)).toBe(true);
    expect(deletedPathnames.has(fixture.problemOnlyAsset.pathname)).toBe(true);
    expect(deletedPathnames.has(fixture.upload.pathname)).toBe(true);
  });
});
