import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/narration/purge.ts` (M5 §7.3, AC 20).
 *
 * `dbMock.narrationAsset` below is STATEFUL, not a fixed-return stub — it
 * tracks a live list of `NarrationAsset` rows and a live set of "asset ids
 * with at least one remaining `LessonNarrationStep`", and its `findMany`
 * actually implements `steps: { none: {} }` against that state, the same
 * technique `tests/unit/lib/deletion/service.test.ts`'s `makeUploadTable`
 * uses for the same reason: a stub that always returns the same fixed array
 * cannot catch a query-SHAPE bug, because it would return the same rows
 * regardless of what production code actually asked for. The real Postgres
 * semantics of `steps: { none: {} }` are cross-checked separately, against a
 * real database, in `tests/integration/narration-deletion-cascade.test.ts`.
 */

let assets: Array<{ id: string; studentProfileId: string; pathname: string }>;
let stepAssetIds: Set<string>;

const dbMock = {
  narrationAsset: {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { studentProfileId: string; steps?: { none: Record<string, never> } };
      }) => {
        return assets
          .filter((asset) => asset.studentProfileId === where.studentProfileId)
          .filter((asset) => (where.steps?.none ? !stepAssetIds.has(asset.id) : true))
          .map((asset) => ({ id: asset.id, pathname: asset.pathname }));
      },
    ),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      const toDelete = new Set(where.id.in);
      const before = assets.length;
      assets = assets.filter((asset) => !toDelete.has(asset.id));
      return { count: before - assets.length };
    }),
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { purgeUnreferencedNarration } = await import("@/lib/narration/purge");

/** A fake `StoragePort` — only `del()` is exercised by this module. */
function fakeStorage(overrides?: { del?: (pathnames: string[]) => Promise<void> }) {
  return {
    handleClientUpload: vi.fn(),
    head: vi.fn(),
    signedReadUrl: vi.fn(),
    readBytes: vi.fn(),
    del: vi.fn(overrides?.del ?? (async () => {})),
    put: vi.fn(),
    listAll: vi.fn(),
  };
}

function resetFakeDb(
  initialAssets: Array<{ id: string; studentProfileId: string; pathname: string }>,
  initialStepAssetIds: string[] = [],
) {
  assets = initialAssets.map((asset) => ({ ...asset }));
  stepAssetIds = new Set(initialStepAssetIds);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb([]);
});

describe("purgeUnreferencedNarration — the query shape (M5 §7.3)", () => {
  it("finds an asset with NO remaining LessonNarrationStep and deletes its blob, then its row", async () => {
    resetFakeDb(
      [{ id: "asset_1", studentProfileId: "sp_1", pathname: "students/sp_1/narration/a.mp3" }],
      [], // no step references asset_1 — it is unreferenced
    );
    const callOrder: string[] = [];
    const storage = fakeStorage({
      del: async (pathnames) => {
        expect(pathnames).toEqual(["students/sp_1/narration/a.mp3"]);
        callOrder.push("storage.del");
      },
    });
    dbMock.narrationAsset.deleteMany.mockImplementation(async ({ where }) => {
      callOrder.push("narrationAsset.deleteMany");
      const toDelete = new Set(where.id.in as string[]);
      const before = assets.length;
      assets = assets.filter((asset) => !toDelete.has(asset.id));
      return { count: before - assets.length };
    });

    const result = await purgeUnreferencedNarration("sp_1", storage);

    expect(result).toEqual({ deleted: 1 });
    expect(callOrder).toEqual(["storage.del", "narrationAsset.deleteMany"]);
    expect(assets).toEqual([]);
  });

  it("never touches an asset that STILL has a referencing LessonNarrationStep", async () => {
    resetFakeDb(
      [{ id: "asset_1", studentProfileId: "sp_1", pathname: "students/sp_1/narration/a.mp3" }],
      ["asset_1"], // a step still references it
    );
    const storage = fakeStorage();

    const result = await purgeUnreferencedNarration("sp_1", storage);

    expect(result).toEqual({ deleted: 0 });
    expect(storage.del).not.toHaveBeenCalled();
    expect(dbMock.narrationAsset.deleteMany).not.toHaveBeenCalled();
    expect(assets).toHaveLength(1);
  });

  it("is scoped to the given studentProfileId — never touches another profile's unreferenced asset", async () => {
    resetFakeDb(
      [{ id: "asset_other", studentProfileId: "sp_2", pathname: "students/sp_2/narration/x.mp3" }],
      [],
    );
    const storage = fakeStorage();

    const result = await purgeUnreferencedNarration("sp_1", storage);

    expect(result).toEqual({ deleted: 0 });
    expect(storage.del).not.toHaveBeenCalled();
    expect(assets).toHaveLength(1);
  });

  it("does nothing, and never calls storage.del or deleteMany, when there is nothing unreferenced", async () => {
    resetFakeDb([]);
    const storage = fakeStorage();

    const result = await purgeUnreferencedNarration("sp_1", storage);

    expect(result).toEqual({ deleted: 0 });
    expect(storage.del).not.toHaveBeenCalled();
    expect(dbMock.narrationAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent — calling it again after a successful purge finds nothing left to do", async () => {
    resetFakeDb([{ id: "asset_1", studentProfileId: "sp_1", pathname: "students/sp_1/narration/a.mp3" }], []);
    const storage = fakeStorage();

    const first = await purgeUnreferencedNarration("sp_1", storage);
    const second = await purgeUnreferencedNarration("sp_1", storage);

    expect(first).toEqual({ deleted: 1 });
    expect(second).toEqual({ deleted: 0 });
  });
});

describe("purgeUnreferencedNarration — blob-before-row ordering (ADR-0007 §1)", () => {
  it("does NOT delete the NarrationAsset row when storage.del() fails", async () => {
    resetFakeDb([{ id: "asset_1", studentProfileId: "sp_1", pathname: "students/sp_1/narration/a.mp3" }], []);
    const storage = fakeStorage({
      del: async () => {
        throw new Error("simulated provider outage");
      },
    });

    await expect(purgeUnreferencedNarration("sp_1", storage)).rejects.toThrow("simulated provider outage");

    expect(dbMock.narrationAsset.deleteMany).not.toHaveBeenCalled();
    expect(assets).toHaveLength(1);
  });
});
