import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { NARRATION_MODEL_ID, CUE_FORMAT_VERSION, NARRATION_RUNS_PER_HOUR, NARRATION_DAILY_BUDGET_CHARS } =
  await import("@/lib/config");

/**
 * **The AC 21 cap bypass, against real Postgres** (2026-09-02 security review).
 *
 * The caps used to window on `LessonNarration.createdAt`:
 *
 *   - `count({ studentProfileId, createdAt: { gte: now - 1h } })`
 *   - `_sum.charactersBilled` over `createdAt >= now - 24h`
 *
 * AC 17's retry is the SAME POST, and the grant `upsert`s on
 * `@@unique([versionId])` — so a retry never inserted a row and **never touched
 * `createdAt`**. The review reproduced it exactly: a row created 25h earlier
 * carrying `charactersBilled: 19_999`, retried three times through the route's
 * own upsert, still counted 0 runs in the hour window and still summed 0
 * characters in the day window. `charactersBilled` was also SET rather than
 * accumulated, so each retry erased the previous attempt's spend.
 *
 * Cache hits are free, so the way to force real billing on every retry was to
 * PATCH `personaId` between POSTs — the cache key is
 * `sha256(text \0 providerVoiceId \0 ttsModelId)`, so a new voice misses every
 * step. An aged row was, in effect, unlimited paid TTS.
 *
 * This file replays that interleaving against the LEDGER and asserts the window
 * now moves. It is an integration test on purpose: the defect was entirely about
 * what `createdAt` does across an upsert, which a mock cannot tell you.
 */

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
});

async function seedNarration() {
  const unique = `${Date.now()}-${Math.random()}`;
  const user = await db.user.create({
    data: { email: `narration-cap-${unique}@example.com`, adultAttestedAt: new Date() },
  });
  createdUserIds.push(user.id);

  const profile = await db.studentProfile.create({
    data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
  });
  const upload = await db.upload.create({
    data: {
      studentProfileId: profile.id,
      pathname: `students/${profile.id}/uploads/cap-${unique}.jpg`,
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
  const lesson = await db.lesson.create({
    data: { studentProfileId: profile.id, extractedProblemId: extractedProblem.id, status: "READY" },
  });
  const version = await db.lessonScriptVersion.create({
    data: {
      lessonId: lesson.id,
      version: 1,
      status: "READY",
      schemaVersion: "1",
      model: "claude-opus-5",
      effort: "high",
      promptVersion: "test",
      stepCount: 2,
    },
  });

  return { profile, lesson, version };
}

/** The exact upsert `grantNarrationRun` performs, plus its ledger insert. */
async function grant(args: { lessonId: string; versionId: string; studentProfileId: string; voiceId: string }) {
  const narration = await db.lessonNarration.upsert({
    where: { versionId: args.versionId },
    create: {
      lessonId: args.lessonId,
      versionId: args.versionId,
      studentProfileId: args.studentProfileId,
      status: "PENDING",
      ttsModelId: NARRATION_MODEL_ID,
      providerVoiceId: args.voiceId,
      cueFormatVersion: CUE_FORMAT_VERSION,
    },
    update: {
      status: "PENDING",
      failureCode: null,
      providerVoiceId: args.voiceId,
      ttsModelId: NARRATION_MODEL_ID,
      charactersBilled: null,
      cacheHits: null,
      startedAt: null,
      completedAt: null,
    },
  });
  const attempt = await db.narrationRunAttempt.create({
    data: { narrationId: narration.id, studentProfileId: args.studentProfileId },
  });
  return { narration, attempt };
}

function countRuns(studentProfileId: string) {
  return db.narrationRunAttempt.count({
    where: { studentProfileId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
}

async function sumBilled(studentProfileId: string) {
  const agg = await db.narrationRunAttempt.aggregate({
    where: { studentProfileId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    _sum: { charactersBilled: true },
  });
  return agg._sum.charactersBilled ?? 0;
}

describe("the AC 21 caps window on a per-attempt ledger", () => {
  it("a retry ADVANCES the run window — the exact bypass, replayed", async () => {
    const { profile, lesson, version } = await seedNarration();

    // The aged row: granted 25 hours ago, outside both windows.
    const { narration, attempt } = await grant({
      lessonId: lesson.id,
      versionId: version.id,
      studentProfileId: profile.id,
      voiceId: "voice_original",
    });
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.lessonNarration.update({ where: { id: narration.id }, data: { createdAt: longAgo } });
    await db.narrationRunAttempt.update({
      where: { id: attempt.id },
      data: { createdAt: longAgo, charactersBilled: 19_999 },
    });

    // Baseline: nothing in either window. This is the state that used to be
    // permanently uncapped.
    expect(await countRuns(profile.id)).toBe(0);
    expect(await sumBilled(profile.id)).toBe(0);
    // And the LessonNarration row's own createdAt is still 25h old, which is
    // what the old windows read — asserted so the fixture is proven, not assumed.
    const aged = await db.lessonNarration.findUniqueOrThrow({ where: { id: narration.id } });
    expect(aged.createdAt.getTime()).toBe(longAgo.getTime());

    // Three retries, each with a different voice — the cache-miss trick that
    // forced real billing on every attempt.
    for (const voiceId of ["voice_b", "voice_c", "voice_d"]) {
      const { narration: retried } = await grant({
        lessonId: lesson.id,
        versionId: version.id,
        studentProfileId: profile.id,
        voiceId,
      });
      // Still ONE narration row, reused — that part of AC 17 is unchanged.
      expect(retried.id).toBe(narration.id);
      // And its createdAt still has not moved. That is precisely why the caps
      // can no longer be keyed on it.
      expect(retried.createdAt.getTime()).toBe(longAgo.getTime());
    }

    // The ledger, however, has three new rows inside the hour window.
    expect(await countRuns(profile.id)).toBe(3);

    const attempts = await db.narrationRunAttempt.count({ where: { narrationId: narration.id } });
    expect(attempts).toBe(4); // the aged one plus three retries
  });

  it("spend ACCUMULATES across retries instead of being overwritten", async () => {
    const { profile, lesson, version } = await seedNarration();

    let total = 0;
    for (const [i, voiceId] of ["voice_a", "voice_b", "voice_c"].entries()) {
      const { attempt } = await grant({
        lessonId: lesson.id,
        versionId: version.id,
        studentProfileId: profile.id,
        voiceId,
      });
      const spent = 1_000 * (i + 1);
      await db.narrationRunAttempt.update({ where: { id: attempt.id }, data: { charactersBilled: spent } });
      total += spent;
    }

    // 6_000, not 3_000 — the pre-fix code SET `charactersBilled` on the one
    // reused row, so the third retry's number replaced the first two entirely.
    expect(await sumBilled(profile.id)).toBe(total);
  });

  it("an aged row's retries reach the hourly ceiling like any other run", async () => {
    const { profile, lesson, version } = await seedNarration();

    for (let i = 0; i < NARRATION_RUNS_PER_HOUR; i++) {
      await grant({
        lessonId: lesson.id,
        versionId: version.id,
        studentProfileId: profile.id,
        voiceId: `voice_${i}`,
      });
    }

    // The cap is now reachable through retries alone. It previously was not
    // reachable at all once the row aged out of the window.
    expect(await countRuns(profile.id)).toBeGreaterThanOrEqual(NARRATION_RUNS_PER_HOUR);
  });

  it("the daily budget is reachable through retries of a single lesson", async () => {
    const { profile, lesson, version } = await seedNarration();

    const perAttempt = Math.ceil(NARRATION_DAILY_BUDGET_CHARS / 3);
    for (const voiceId of ["voice_a", "voice_b", "voice_c"]) {
      const { attempt } = await grant({
        lessonId: lesson.id,
        versionId: version.id,
        studentProfileId: profile.id,
        voiceId,
      });
      await db.narrationRunAttempt.update({ where: { id: attempt.id }, data: { charactersBilled: perAttempt } });
    }

    expect(await sumBilled(profile.id)).toBeGreaterThanOrEqual(NARRATION_DAILY_BUDGET_CHARS);
  });

  it("the ledger is scoped per profile, and cascades with the narration row", async () => {
    const a = await seedNarration();
    const b = await seedNarration();

    await grant({ lessonId: a.lesson.id, versionId: a.version.id, studentProfileId: a.profile.id, voiceId: "v" });
    const { narration: bNarration } = await grant({
      lessonId: b.lesson.id,
      versionId: b.version.id,
      studentProfileId: b.profile.id,
      voiceId: "v",
    });

    // One profile's spend must never bound another's.
    expect(await countRuns(a.profile.id)).toBe(1);
    expect(await countRuns(b.profile.id)).toBe(1);

    // A ledger row is operational data about a child; it must not outlive the
    // narration it belongs to.
    await db.lessonNarration.delete({ where: { id: bNarration.id } });
    expect(await db.narrationRunAttempt.count({ where: { narrationId: bNarration.id } })).toBe(0);
    expect(await countRuns(a.profile.id)).toBe(1);
  });

  it("the ledger cascades with the student profile (COPPA §312.6)", async () => {
    const { profile, lesson, version } = await seedNarration();
    await grant({ lessonId: lesson.id, versionId: version.id, studentProfileId: profile.id, voiceId: "v" });

    expect(await db.narrationRunAttempt.count({ where: { studentProfileId: profile.id } })).toBe(1);

    await db.studentProfile.delete({ where: { id: profile.id } });

    expect(await db.narrationRunAttempt.count({ where: { studentProfileId: profile.id } })).toBe(0);
  });
});
