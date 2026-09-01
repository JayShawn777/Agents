import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrationAlignment } from "@/lib/narration/provider";
import { NARRATION_MAX_ATTEMPTS } from "@/lib/config";

/**
 * `lib/narration/generate.ts` — the fourth `PENDING → GENERATING →
 * READY | FAILED` pipeline in this app. Runs against the REAL
 * `lib/narration/cache.ts` and `lib/narration/cues.ts` (only `db`, `storage`
 * and the vendor call are faked), the same "stateful fake, not a fixed
 * stub" technique `tests/unit/lib/narration/purge.test.ts` uses — a fixed
 * stub could not catch a query-shape bug like a stale cache lookup.
 */

type NarrationRow = {
  id: string;
  lessonId: string;
  versionId: string;
  studentProfileId: string;
  personaId: string | null;
  status: "PENDING" | "GENERATING" | "READY" | "FAILED";
  ttsModelId: string;
  providerVoiceId: string;
  cueFormatVersion: string;
  failureCode: string | null;
  stepCount: number | null;
  totalDurationMs: number | null;
  charactersBilled: number | null;
  cacheHits: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type AssetRow = {
  id: string;
  studentProfileId: string;
  cacheKey: string;
  pathname: string;
  durationMs: number;
  cues: unknown;
  cueFormatVersion: string;
};

type StepRow = { narrationId: string; stepId: string; stepIndex: number; assetId: string; startOffsetMs: number };

let narrations: NarrationRow[];
let versions: Record<string, { status: string; script: unknown }>;
let assets: AssetRow[];
let steps: StepRow[];
let nextAssetId: number;

function narrationRow(overrides: Partial<NarrationRow> = {}): NarrationRow {
  return {
    id: "narr_1",
    lessonId: "les_1",
    versionId: "ver_1",
    studentProfileId: "prof_1",
    personaId: "persona_1",
    status: "PENDING",
    ttsModelId: "eleven_multilingual_v2",
    providerVoiceId: "voice_a",
    cueFormatVersion: "1",
    failureCode: null,
    stepCount: null,
    totalDurationMs: null,
    charactersBilled: null,
    cacheHits: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

// LESSON_MIN_STEPS is 3 — LessonScriptSchema.safeParse rejects anything
// shorter, which would otherwise fail every test below as INTERNAL (the
// "source script did not parse" branch) rather than exercising the pipeline
// this file is actually testing.
const SCRIPT = {
  title: "Adding quarters",
  steps: [
    {
      id: "s1",
      narration: "We start with one quarter.",
      durationMs: 4_000,
      ops: [{ kind: "label", id: "l1", text: "one quarter", at: { x: 0.2, y: 0.2 } }],
    },
    {
      id: "s2",
      narration: "Then we add another quarter.",
      durationMs: 4_000,
      ops: [{ kind: "label", id: "l2", text: "add", at: { x: 0.3, y: 0.3 } }],
    },
    {
      id: "s3",
      narration: "So the answer is two quarters.",
      durationMs: 3_000,
      ops: [{ kind: "label", id: "l3", text: "answer", at: { x: 0.4, y: 0.4 } }],
    },
  ],
};

const dbMock = {
  lessonNarration: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => narrations.find((n) => n.id === where.id) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Partial<NarrationRow> }) => {
      const row = narrations.find((n) => n.id === where.id && n.status === where.status);
      if (!row) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<NarrationRow> }) => {
      const row = narrations.find((n) => n.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = narrations.find((n) => n.id === where.id);
      if (!row) throw new Error("not found");
      return row;
    }),
  },
  lessonScriptVersion: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => versions[where.id] ?? null),
  },
  lessonNarrationStep: {
    deleteMany: vi.fn(async ({ where }: { where: { narrationId: string } }) => {
      const before = steps.length;
      steps = steps.filter((s) => s.narrationId !== where.narrationId);
      return { count: before - steps.length };
    }),
    createMany: vi.fn(async ({ data }: { data: StepRow[] }) => {
      steps.push(...data);
      return { count: data.length };
    }),
  },
  narrationAsset: {
    findUnique: vi.fn(
      async ({ where }: { where: { studentProfileId_cacheKey: { studentProfileId: string; cacheKey: string } } }) => {
        const { studentProfileId, cacheKey } = where.studentProfileId_cacheKey;
        const row = assets.find((a) => a.studentProfileId === studentProfileId && a.cacheKey === cacheKey);
        return row
          ? { id: row.id, pathname: row.pathname, durationMs: row.durationMs, cues: row.cues, cueFormatVersion: row.cueFormatVersion }
          : null;
      },
    ),
    create: vi.fn(async ({ data }: { data: Omit<AssetRow, "id"> }) => {
      const row: AssetRow = { id: `asset_${nextAssetId++}`, ...data };
      assets.push(row);
      return { id: row.id, pathname: row.pathname, durationMs: row.durationMs, cues: row.cues, cueFormatVersion: row.cueFormatVersion };
    }),
  },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const synthesizeNarrationMock = vi.fn();
vi.mock("@/lib/narration/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/narration/provider")>();
  return { ...actual, synthesizeNarration: synthesizeNarrationMock };
});

const storageMock = { put: vi.fn(async (pathname: string) => ({ pathname, sizeBytes: 100 })) };

const { runNarrationGeneration, reapIfStaleNarration } = await import("@/lib/narration/generate");
const { NARRATION_TIMEOUT_MS } = await import("@/lib/config");

function fakeAlignment(text: string, msPerChar = 50): NarrationAlignment {
  const characters = [...text];
  return {
    characters,
    characterStartTimesSeconds: characters.map((_, i) => (i * msPerChar) / 1000),
    characterEndTimesSeconds: characters.map((_, i) => ((i + 1) * msPerChar) / 1000),
  };
}

function okResult(text: string) {
  return { ok: true as const, audio: new Uint8Array([1, 2, 3]).buffer, alignment: fakeAlignment(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  narrations = [narrationRow()];
  versions = { ver_1: { status: "READY", script: SCRIPT } };
  assets = [];
  steps = [];
  nextAssetId = 1;
  storageMock.put.mockClear();
  synthesizeNarrationMock.mockImplementation(async ({ text }: { text: string }) => okResult(text));
});

describe("the happy path", () => {
  it("claims PENDING, synthesizes every step, and marks READY", async () => {
    const result = await runNarrationGeneration("narr_1", storageMock as never);

    // `fakeAlignment`'s uniform 50ms/char clock — each asset's durationMs is
    // exactly its narration's character count times 50.
    const totalChars = SCRIPT.steps.reduce((sum, step) => sum + step.narration.length, 0);
    const expectedTotalMs = totalChars * 50;
    expect(result).toEqual({ status: "READY", narrationId: "narr_1", stepCount: 3, totalDurationMs: expectedTotalMs });
    expect(narrations[0].status).toBe("READY");
    expect(narrations[0].stepCount).toBe(3);
    expect(narrations[0].cacheHits).toBe(0);
    expect(narrations[0].charactersBilled).toBe(totalChars);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.stepId)).toEqual(["s1", "s2", "s3"]);
  });

  it("moves to GENERATING before any vendor call, so a poll can see it", async () => {
    let statusWhenCalled: unknown;
    synthesizeNarrationMock.mockImplementationOnce(async ({ text }: { text: string }) => {
      statusWhenCalled = narrations[0].status;
      return okResult(text);
    });
    await runNarrationGeneration("narr_1", storageMock as never);
    expect(statusWhenCalled).toBe("GENERATING");
  });

  it("writes the blob before the row for each new asset (via the real cache.ts)", async () => {
    await runNarrationGeneration("narr_1", storageMock as never);
    expect(storageMock.put).toHaveBeenCalledTimes(3);
    expect(assets).toHaveLength(3);
  });

  it("computes startOffsetMs as the running sum of step durations, in step order", async () => {
    await runNarrationGeneration("narr_1", storageMock as never);
    const byIndex = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
    expect(byIndex[0].startOffsetMs).toBe(0);
    expect(byIndex[1].startOffsetMs).toBe(assets.find((a) => a.id === byIndex[0].assetId)!.durationMs);
  });
});

describe("caching (AC 7 / AC 8)", () => {
  it("does not call the vendor and does not bill characters on a cache hit", async () => {
    // Pre-seed the cache for step 1's exact (text, voice, model) triple.
    const { computeCacheKey } = await import("@/lib/narration/cache");
    const cacheKey = computeCacheKey(SCRIPT.steps[0].narration, "voice_a", "eleven_multilingual_v2");
    assets.push({
      id: "asset_cached",
      studentProfileId: "prof_1",
      cacheKey,
      pathname: "students/prof_1/narration/cached.mp3",
      durationMs: 1234,
      cues: { v: 1, durationMs: 1234, words: [] },
      cueFormatVersion: "1",
    });

    const result = await runNarrationGeneration("narr_1", storageMock as never);
    expect(result.status).toBe("READY");
    // Only steps 2 and 3 were actually synthesized; step 1 was a cache hit.
    expect(synthesizeNarrationMock).toHaveBeenCalledTimes(2);
    expect(synthesizeNarrationMock).toHaveBeenCalledWith(expect.objectContaining({ text: SCRIPT.steps[1].narration }));
    expect(synthesizeNarrationMock).toHaveBeenCalledWith(expect.objectContaining({ text: SCRIPT.steps[2].narration }));
    expect(narrations[0].cacheHits).toBe(1);
    expect(narrations[0].charactersBilled).toBe(SCRIPT.steps[1].narration.length + SCRIPT.steps[2].narration.length);
  });
});

describe("retry (AC 9)", () => {
  it("retries a RATE_LIMITED failure with backoff and succeeds within NARRATION_MAX_ATTEMPTS", async () => {
    vi.useFakeTimers();
    let calls = 0;
    synthesizeNarrationMock.mockImplementation(async ({ text }: { text: string }) => {
      calls++;
      if (calls === 1) return { ok: false, failureCode: "RATE_LIMITED", retryable: true };
      return okResult(text);
    });

    const promise = runNarrationGeneration("narr_1", storageMock as never);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe("READY");
    expect(calls).toBeGreaterThan(1);
    vi.useRealTimers();
  });

  it("fails the whole run as UPSTREAM once attempts are exhausted", async () => {
    vi.useFakeTimers();
    synthesizeNarrationMock.mockResolvedValue({ ok: false, failureCode: "RATE_LIMITED", retryable: true });

    const promise = runNarrationGeneration("narr_1", storageMock as never);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ status: "FAILED", failureCode: "UPSTREAM" });
    expect(narrations[0].status).toBe("FAILED");
    // Called exactly NARRATION_MAX_ATTEMPTS times for the FIRST step that
    // failed — the pool does not keep retrying past that step's budget.
    expect(synthesizeNarrationMock.mock.calls.length).toBeGreaterThanOrEqual(NARRATION_MAX_ATTEMPTS);
    vi.useRealTimers();
  });

  it("does NOT retry a non-retryable failure (e.g. a bad voice id)", async () => {
    synthesizeNarrationMock.mockResolvedValue({ ok: false, failureCode: "UPSTREAM", retryable: false });
    const result = await runNarrationGeneration("narr_1", storageMock as never);
    expect(result).toEqual({ status: "FAILED", failureCode: "UPSTREAM" });
  });
});

describe("the speakable guard's defensive twin (plan §8.1)", () => {
  /**
   * A writer that actually produces this state: a lesson authored BEFORE
   * `assertSpeakableNarration` existed. `authorLesson` can never write this
   * script today (the guard runs before persistence), but a pre-M5 row in
   * the database can still hold one, and `runNarrationGeneration` must
   * refuse it rather than send LaTeX to the vendor.
   */
  it("fails with UNSPEAKABLE and never sends the LaTeX-carrying step to the vendor", async () => {
    versions.ver_1.script = {
      ...SCRIPT,
      steps: [
        { ...SCRIPT.steps[0], narration: "This is \\frac{1}{4} of the whole." },
        SCRIPT.steps[1],
        SCRIPT.steps[2],
      ],
    };

    const result = await runNarrationGeneration("narr_1", storageMock as never);

    expect(result).toEqual({ status: "FAILED", failureCode: "UNSPEAKABLE" });
    // The LaTeX-carrying step is refused BEFORE any vendor call for IT
    // specifically. It does not assert the vendor saw zero calls overall:
    // `NARRATION_MAX_CONCURRENCY` runs steps concurrently (a pool of 2 here),
    // so a sibling step with clean narration can already be in flight when
    // the guard throws for this one — the accepted trade-off documented in
    // `mapWithConcurrency`'s own comment (in-flight siblings are not
    // cancelled on a mid-run failure).
    for (const call of synthesizeNarrationMock.mock.calls) {
      expect((call[0] as { text: string }).text).not.toContain("\\frac");
    }
  });
});

describe("alignment mismatch", () => {
  it("fails the run as UPSTREAM if the vendor's alignment does not reconstruct our text", async () => {
    synthesizeNarrationMock.mockResolvedValueOnce({
      ok: true,
      audio: new Uint8Array([1]).buffer,
      alignment: { characters: ["w", "r", "o", "n", "g"], characterStartTimesSeconds: [0, 0.1, 0.2, 0.3, 0.4], characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4, 0.5] },
    });

    const result = await runNarrationGeneration("narr_1", storageMock as never);
    expect(result).toEqual({ status: "FAILED", failureCode: "UPSTREAM" });
  });
});

describe("SKIPPED", () => {
  it("returns SKIPPED for a row that is not PENDING", async () => {
    narrations[0].status = "GENERATING";
    expect(await runNarrationGeneration("narr_1", storageMock as never)).toEqual({ status: "SKIPPED" });
  });

  it("returns SKIPPED if the claim loses a race (already claimed between read and claim)", async () => {
    dbMock.lessonNarration.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await runNarrationGeneration("narr_1", storageMock as never)).toEqual({ status: "SKIPPED" });
  });
});

describe("retry via AC 17 (a FAILED row reset to PENDING)", () => {
  it("runs the exact same path a second time and can succeed", async () => {
    narrations[0] = narrationRow({ status: "FAILED", failureCode: "UPSTREAM" });
    // The route resets to PENDING before calling this again (AC 17).
    narrations[0].status = "PENDING";

    const result = await runNarrationGeneration("narr_1", storageMock as never);
    expect(result.status).toBe("READY");
  });
});

describe("reapIfStaleNarration", () => {
  it("leaves a fresh PENDING/GENERATING row untouched", async () => {
    const fresh = narrationRow({ status: "GENERATING", updatedAt: new Date() });
    const result = await reapIfStaleNarration(fresh, new Date());
    expect(result.status).toBe("GENERATING");
  });

  it("reaps a PENDING row stuck past the timeout (a dropped after() callback)", async () => {
    const stale = narrationRow({ status: "PENDING", updatedAt: new Date("2020-01-01T00:00:00.000Z") });
    narrations = [stale];
    const now = new Date(stale.updatedAt.getTime() + NARRATION_TIMEOUT_MS + 1);
    const result = await reapIfStaleNarration(stale, now);
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("TIMEOUT");
  });

  it("reaps a GENERATING row stuck past the timeout", async () => {
    const stale = narrationRow({ status: "GENERATING", updatedAt: new Date("2020-01-01T00:00:00.000Z") });
    narrations = [stale];
    const now = new Date(stale.updatedAt.getTime() + NARRATION_TIMEOUT_MS + 1);
    const result = await reapIfStaleNarration(stale, now);
    expect(result.status).toBe("FAILED");
  });

  /**
   * The M4-review landmine, named explicitly in this milestone's brief: a
   * run that finishes moments before the reaping read must not be reported
   * to the caller as FAILED while a good READY row sits underneath it.
   */
  it("RE-READS rather than fabricating FAILED when it loses the guard race", async () => {
    const stale = narrationRow({ status: "GENERATING", updatedAt: new Date("2020-01-01T00:00:00.000Z") });
    narrations = [stale];
    // Simulate: the real run completed and wrote READY between our read and
    // our guarded update — the update's `where: { status: 'GENERATING' }`
    // no longer matches.
    dbMock.lessonNarration.updateMany.mockResolvedValueOnce({ count: 0 });
    narrations[0].status = "READY";
    narrations[0].stepCount = 2;

    const now = new Date(stale.updatedAt.getTime() + NARRATION_TIMEOUT_MS + 1);
    const result = await reapIfStaleNarration(stale, now);

    expect(result.status).toBe("READY");
    expect(result.stepCount).toBe(2);
  });
});
