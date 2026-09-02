import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/narration/cache.ts` — ADR-0015's per-profile cache: the key, the
 * pathname, and the write-races-the-unique-constraint recovery path.
 */

type AssetRow = {
  id: string;
  studentProfileId: string;
  cacheKey: string;
  pathname: string;
  durationMs: number;
  cues: unknown;
  cueFormatVersion: string;
};

let assets: AssetRow[];
let nextId: number;

const SELECT_KEYS = ["id", "pathname", "durationMs", "cues", "cueFormatVersion"] as const;
function project(row: AssetRow) {
  const out: Record<string, unknown> = {};
  for (const key of SELECT_KEYS) out[key] = row[key as keyof AssetRow];
  return out;
}

const dbMock = {
  narrationAsset: {
    findUnique: vi.fn(async ({ where }: { where: { studentProfileId_cacheKey: { studentProfileId: string; cacheKey: string } } }) => {
      const { studentProfileId, cacheKey } = where.studentProfileId_cacheKey;
      const row = assets.find((a) => a.studentProfileId === studentProfileId && a.cacheKey === cacheKey);
      return row ? project(row) : null;
    }),
    create: vi.fn(async ({ data }: { data: Omit<AssetRow, "id"> }) => {
      const existing = assets.find((a) => a.studentProfileId === data.studentProfileId && a.cacheKey === data.cacheKey);
      if (existing) {
        // Prisma's own behaviour on a `@@unique` collision.
        const err = new Error("Unique constraint failed") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const row: AssetRow = { id: `asset_${nextId++}`, ...data };
      assets.push(row);
      return project(row);
    }),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const storageMock = {
  put: vi.fn(async (pathname: string, data: ArrayBuffer | Uint8Array) => ({
    pathname,
    sizeBytes: data instanceof Uint8Array ? data.byteLength : data.byteLength,
  })),
  del: vi.fn<(pathnames: string[]) => Promise<void>>(async () => {}),
};

const { computeCacheKey, narrationAssetPathname, lookupNarrationAsset, writeNarrationAsset } = await import(
  "@/lib/narration/cache"
);

beforeEach(() => {
  vi.clearAllMocks();
  assets = [];
  nextId = 1;
  storageMock.put.mockClear();
});

describe("computeCacheKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(computeCacheKey("one quarter", "voice_a", "model_a")).toBe(computeCacheKey("one quarter", "voice_a", "model_a"));
  });

  it("differs when the text, the voice, or the model differs", () => {
    const base = computeCacheKey("one quarter", "voice_a", "model_a");
    expect(computeCacheKey("two quarters", "voice_a", "model_a")).not.toBe(base);
    expect(computeCacheKey("one quarter", "voice_b", "model_a")).not.toBe(base);
    expect(computeCacheKey("one quarter", "voice_a", "model_b")).not.toBe(base);
  });

  /**
   * The \0 delimiter is what stops "a" + "bc" colliding with "ab" + "c" —
   * plain concatenation of the three fields would not have this property.
   */
  it("does not collide across a shifted boundary a naive concatenation would", () => {
    const a = computeCacheKey("ab", "c", "d");
    const b = computeCacheKey("a", "bc", "d");
    expect(a).not.toBe(b);
  });

  it("is a hex sha256 digest (64 hex characters)", () => {
    expect(computeCacheKey("x", "y", "z")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("narrationAssetPathname", () => {
  it("matches ADR-0015's shape, with a per-attempt nonce", () => {
    expect(narrationAssetPathname("prof_1", "abc123")).toMatch(
      /^students\/prof_1\/narration\/abc123-[0-9a-f]{16}\.mp3$/,
    );
  });

  /**
   * The 2026-09-02 review's finding, as a test. A path that was a pure function
   * of (profile, cacheKey) meant two concurrent writers for the same sentence
   * derived the SAME object, so the P2002 loser's `put` overwrote the winner's
   * bytes and the surviving row described audio that was no longer there.
   */
  it("never returns the same pathname twice for the same (profile, cacheKey)", () => {
    const seen = new Set(Array.from({ length: 50 }, () => narrationAssetPathname("prof_1", "abc123")));
    expect(seen.size).toBe(50);
  });

  it("stays inside the dev object route's strict pathname pattern", () => {
    // `app/api/dev/local-object/route.ts` only serves pathnames matching this,
    // so a nonce containing anything outside [A-Za-z0-9_-] would make locally
    // generated audio unfetchable — silently, and only in dev.
    expect(narrationAssetPathname("prof_1", "abc123")).toMatch(
      /^students\/([A-Za-z0-9_-]+)\/narration\/([A-Za-z0-9_-]+)\.mp3$/,
    );
  });
});

describe("lookupNarrationAsset", () => {
  it("returns null on a miss", async () => {
    expect(await lookupNarrationAsset("prof_1", "nope")).toBeNull();
  });

  it("returns the row on a hit, scoped to the profile", async () => {
    assets.push({
      id: "asset_x",
      studentProfileId: "prof_1",
      cacheKey: "key_a",
      pathname: "students/prof_1/narration/key_a.mp3",
      durationMs: 1000,
      cues: { v: 1, durationMs: 1000, words: [] },
      cueFormatVersion: "1",
    });

    const found = await lookupNarrationAsset("prof_1", "key_a");
    expect(found?.id).toBe("asset_x");

    // Same cacheKey, different profile — the cache is per-profile (ADR-0015), never global.
    expect(await lookupNarrationAsset("prof_2", "key_a")).toBeNull();
  });
});

describe("writeNarrationAsset", () => {
  const baseInput = {
    studentProfileId: "prof_1",
    personaId: "persona_1",
    cacheKey: "key_a",
    providerVoiceId: "voice_a",
    ttsModelId: "model_a",
    audio: new Uint8Array([1, 2, 3]).buffer,
    durationMs: 1200,
    characterCount: 11,
    cues: { v: 1, durationMs: 1200, words: [] },
    cueFormatVersion: "1",
  };

  it("writes the blob BEFORE the row", async () => {
    const calls: string[] = [];
    storageMock.put.mockImplementation(async (pathname: string) => {
      calls.push("put");
      return { pathname, sizeBytes: 3 };
    });
    const realCreate = dbMock.narrationAsset.create.getMockImplementation()!;
    dbMock.narrationAsset.create.mockImplementationOnce(async (args: Parameters<typeof realCreate>[0]) => {
      calls.push("create");
      return realCreate(args);
    });

    await writeNarrationAsset(storageMock as never, baseInput);
    // put() happens first because writeNarrationAsset awaits it before ever
    // calling db.narrationAsset.create.
    expect(calls).toEqual(["put", "create"]);
  });

  it("creates a row at the ADR-0015 pathname, and puts the bytes at that same path", async () => {
    const asset = await writeNarrationAsset(storageMock as never, baseInput);
    expect(asset.pathname).toMatch(/^students\/prof_1\/narration\/key_a-[0-9a-f]{16}\.mp3$/);
    // The row and the object must agree — asserted against the row's own value
    // rather than a literal, now that the nonce makes the path unpredictable.
    expect(storageMock.put).toHaveBeenCalledWith(asset.pathname, baseInput.audio, "audio/mpeg");
  });

  /**
   * The race this function exists to survive: two concurrent misses for the
   * SAME (profile, cacheKey) both synthesize and both try to create. The
   * loser's `create` collides (P2002); it must re-read and return the
   * WINNER's row rather than throwing or duplicating.
   */
  it("on a unique-constraint race, re-reads and returns the winner's row instead of throwing", async () => {
    // Simulate: another caller already wrote the row between our lookup miss
    // and our own create attempt.
    assets.push({
      id: "asset_winner",
      studentProfileId: baseInput.studentProfileId,
      cacheKey: baseInput.cacheKey,
      pathname: "students/prof_1/narration/key_a-aaaaaaaaaaaaaaaa.mp3",
      durationMs: 999,
      cues: { v: 1, durationMs: 999, words: [] },
      cueFormatVersion: "1",
    });

    const result = await writeNarrationAsset(storageMock as never, baseInput);
    expect(result.id).toBe("asset_winner");
    expect(result.durationMs).toBe(999);
    // Exactly one row exists — the loser's create did not duplicate it.
    expect(assets.filter((a) => a.cacheKey === baseInput.cacheKey && a.studentProfileId === baseInput.studentProfileId)).toHaveLength(1);
  });

  /**
   * The other half of the same race, and the actual defect the 2026-09-02
   * review reproduced: the loser must not have written over the winner's
   * object, and must clean up its own.
   */
  it("does not touch the winner's blob, and deletes its own orphaned one", async () => {
    const winnerPathname = "students/prof_1/narration/key_a-aaaaaaaaaaaaaaaa.mp3";
    assets.push({
      id: "asset_winner",
      studentProfileId: baseInput.studentProfileId,
      cacheKey: baseInput.cacheKey,
      pathname: winnerPathname,
      durationMs: 999,
      cues: { v: 1, durationMs: 999, words: [] },
      cueFormatVersion: "1",
    });

    await writeNarrationAsset(storageMock as never, baseInput);

    const putPath = storageMock.put.mock.calls[0][0] as string;
    expect(putPath).not.toBe(winnerPathname);
    expect(storageMock.del).toHaveBeenCalledWith([putPath]);
    // Nothing was written to, or deleted from, the winner's path.
    expect(storageMock.del).not.toHaveBeenCalledWith([winnerPathname]);
  });
});
