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
        where: {
          studentProfileId?: string;
          id?: { in: string[] };
          steps?: { none: Record<string, never> };
        };
      }) => {
        // Every clause is OPTIONAL and independently applied: purge issues two
        // different shapes — the orphan scan (`studentProfileId` + `steps`) and
        // the survivors re-read (`id.in` alone). A mock that assumed the first
        // shape returned nothing for the second, which is a mock bug that reads
        // exactly like an over-delete.
        return assets
          .filter((asset) => (where.studentProfileId ? asset.studentProfileId === where.studentProfileId : true))
          .filter((asset) => (where.id ? where.id.in.includes(asset.id) : true))
          .filter((asset) => (where.steps?.none ? !stepAssetIds.has(asset.id) : true))
          .map((asset) => ({ id: asset.id, pathname: asset.pathname }));
      },
    ),
    // Honours `steps: { none: {} }` the same way `findMany` does. That predicate
    // being REPEATED in the delete is the fix for the over-delete race, so a
    // mock that ignored it could not tell the fix from its absence.
    deleteMany: vi.fn(
      async ({ where }: { where: { id: { in: string[] }; steps?: { none: Record<string, never> } } }) => {
        const toDelete = new Set(where.id.in);
        const before = assets.length;
        assets = assets.filter(
          (asset) => !(toDelete.has(asset.id) && (where.steps?.none ? !stepAssetIds.has(asset.id) : true)),
        );
        return { count: before - assets.length };
      },
    ),
  },
  /** Runs the callback against the same stateful mock, as an interactive tx would. */
  $transaction: vi.fn(async (fn: (tx: typeof dbMock) => Promise<unknown>) => fn(dbMock)),
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
  it("finds an asset with NO remaining LessonNarrationStep and deletes its row, then its blob", async () => {
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
    // `Once`, and delegating to the real mock implementation: a persistent
    // `mockImplementation` here would survive `vi.clearAllMocks()` and silently
    // replace the `steps: { none: {} }`-aware version for every later test in
    // this file — which is how the over-delete regression test below first
    // "failed".
    const realDeleteMany = dbMock.narrationAsset.deleteMany.getMockImplementation()!;
    dbMock.narrationAsset.deleteMany.mockImplementationOnce(async (args) => {
      callOrder.push("narrationAsset.deleteMany");
      return realDeleteMany(args);
    });

    const result = await purgeUnreferencedNarration("sp_1", storage);

    expect(result).toEqual({ deleted: 1 });
    // ROWS FIRST — see the describe block below for why this reversed.
    expect(callOrder).toEqual(["narrationAsset.deleteMany", "storage.del"]);
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

/**
 * **This ordering was DELIBERATELY REVERSED on 2026-09-02, and the previous
 * assertion in this block was inverted with it.**
 *
 * It used to assert blob-before-row, citing ADR-0007 §1. That rule is about
 * WRITES — it exists so a row never points at a blob that isn't there yet. On a
 * DELETE path the two orderings fail in opposite directions:
 *
 *   - blob first, then a crash  ->  a live row pointing at deleted audio. The
 *     lesson 404s forever and nothing reports it.
 *   - row first, then a crash   ->  an unreferenced blob, which
 *     `reconcile-blobs` collects within the hour.
 *
 * The second is recoverable, so that is the one we take. The change was forced
 * by the over-delete fix anyway: the delete has to happen inside the transaction
 * that re-asserts `steps: { none: {} }`, and a blob deleted before that
 * transaction commits is gone even when the transaction aborts.
 */
describe("purgeUnreferencedNarration — row-before-blob ordering, and why", () => {
  it("has ALREADY deleted the row when storage.del() fails, and lets the error surface", async () => {
    resetFakeDb([{ id: "asset_1", studentProfileId: "sp_1", pathname: "students/sp_1/narration/a.mp3" }], []);
    const storage = fakeStorage({
      del: async () => {
        throw new Error("simulated provider outage");
      },
    });

    await expect(purgeUnreferencedNarration("sp_1", storage)).rejects.toThrow("simulated provider outage");

    // The row is gone and the blob is not. That is the recoverable failure:
    // `reconcile-blobs` sees an object no claimant owns and collects it.
    expect(dbMock.narrationAsset.deleteMany).toHaveBeenCalled();
    expect(assets).toHaveLength(0);
  });
});

/**
 * The 2026-09-02 security review's finding, as a regression test. The
 * `findMany` and the `deleteMany` were two un-transacted statements, so a
 * narration run committing its steps in the gap had them cascade-deleted
 * (`LessonNarrationStep.assetId onDelete: Cascade`) and its blob removed —
 * leaving a READY narration with `stepCount: N` and zero steps.
 *
 * The unit-level guard is the repeated predicate: an asset that gained a step
 * after the read must survive the delete. Real Postgres isolation is exercised
 * separately in `tests/integration/narration-deletion-cascade.test.ts`.
 */
describe("purgeUnreferencedNarration — the over-delete race (2026-09-02)", () => {
  it("does not delete an asset that acquired a step between the read and the delete", async () => {
    resetFakeDb(
      [
        { id: "asset_racing", studentProfileId: "sp_1", pathname: "students/sp_1/narration/racing.mp3" },
        { id: "asset_orphan", studentProfileId: "sp_1", pathname: "students/sp_1/narration/orphan.mp3" },
      ],
      [],
    );

    // The interleaving: a narration run commits steps pointing at asset_racing
    // AFTER purge has read the orphan list but BEFORE it deletes.
    const realFindMany = dbMock.narrationAsset.findMany.getMockImplementation()!;
    dbMock.narrationAsset.findMany.mockImplementationOnce(async (args) => {
      const rows = await realFindMany(args);
      stepAssetIds.add("asset_racing"); // the racing run commits, right here
      return rows;
    });

    const storage = fakeStorage();
    const result = await purgeUnreferencedNarration("sp_1", storage);

    // Only the genuine orphan went.
    expect(result).toEqual({ deleted: 1 });
    expect(assets.map((asset) => asset.id)).toEqual(["asset_racing"]);
    // And critically: the racing asset's BLOB was never deleted either, so the
    // steps that now point at it still resolve to real audio.
    expect(storage.del).toHaveBeenCalledWith(["students/sp_1/narration/orphan.mp3"]);
  });
});
