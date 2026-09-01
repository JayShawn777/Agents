import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for `deleteStudentData` (`lib/deletion/service.ts`, B13)
 * against a mocked `db` and a FAKE `StoragePort` — no `@vercel/blob`
 * import exists anywhere in this file, matching the plan's "unit-testable
 * against a fake" requirement (ADR-0007 §4).
 *
 * Two things this suite must prove:
 *   1. Blob-before-row ordering: `storage.del()` runs, and completes,
 *      strictly before any row-destroying call (`parentalConsent.deleteMany`,
 *      `studentProfile.delete`) — ADR-0007 §1.
 *   2. A storage failure leaves every row untouched (Upload rows aside,
 *      which are marked SOURCE_DELETED before the storage call by design)
 *      — no consent pseudonymisation, no DeletionAudit, no profile
 *      deletion — and reports `STORAGE_FAILURE` rather than throwing.
 */

const dbMock = {
  upload: {
    // Typed (via the generic, with no implementation) to accept the `where`
    // shape production code actually passes, so the stateful fake table
    // (below, in the retry regression suite) can be installed via
    // `.mockImplementation()` without a signature mismatch. Every test sets
    // a real implementation before use (`beforeEach` below, or its own
    // `mockResolvedValue`/`mockImplementation`).
    findMany:
      vi.fn<(args: { where: { studentProfileId: string; status?: { not: string } } }) => Promise<Array<{ pathname: string }>>>(),
    updateMany: vi.fn(),
  },
  // M5 §7.2 — the second registered `PROFILE_BLOB_SOURCES` entry. A model
  // whose rows are scoped to a profile and own a blob pathname, read
  // unconditionally (no status column, no filter) just like `upload` is.
  narrationAsset: {
    findMany: vi.fn<(args: { where: { studentProfileId: string } }) => Promise<Array<{ pathname: string }>>>(),
  },
  parentalConsent: {
    findMany: vi.fn(async () => [] as unknown[]),
    deleteMany: vi.fn(),
  },
  user: { findMany: vi.fn(async () => [] as unknown[]) },
  consentAuditArtifact: { createMany: vi.fn() },
  deletionAudit: { create: vi.fn() },
  studentProfile: { delete: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { deleteStudentData } = await import("@/lib/deletion/service");

/** A fake `StoragePort` — only `del()` is exercised by this module. */
function fakeStorage(overrides?: { del?: (pathnames: string[]) => Promise<void> }) {
  return {
    handleClientUpload: vi.fn(),
    head: vi.fn(),
    signedReadUrl: vi.fn(),
    readBytes: vi.fn(),
    del: vi.fn(overrides?.del ?? (async () => {})),
    listAll: vi.fn(),
    put: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.upload.findMany.mockResolvedValue([]);
  dbMock.narrationAsset.findMany.mockResolvedValue([]);
  dbMock.parentalConsent.findMany.mockResolvedValue([]);
  dbMock.user.findMany.mockResolvedValue([]);
});

describe("deleteStudentData — blob-before-row ordering (ADR-0007 §1)", () => {
  it("marks Upload rows SOURCE_DELETED, then calls storage.del(), then deletes rows — in that order", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/a.jpg" }]);
    const callOrder: string[] = [];
    dbMock.upload.updateMany.mockImplementation(async () => {
      callOrder.push("upload.updateMany(SOURCE_DELETED)");
      return { count: 1 };
    });
    const storage = fakeStorage({
      del: async (pathnames) => {
        expect(pathnames).toEqual(["students/sp_1/uploads/a.jpg"]);
        callOrder.push("storage.del");
      },
    });
    dbMock.parentalConsent.deleteMany.mockImplementation(async () => {
      callOrder.push("parentalConsent.deleteMany");
      return { count: 0 };
    });
    dbMock.studentProfile.delete.mockImplementation(async () => {
      callOrder.push("studentProfile.delete");
    });
    dbMock.parentalConsent.findMany.mockResolvedValue([
      {
        id: "consent_1",
        userId: "user_1",
        studentProfileId: "sp_1",
        consentTextVersion: "v1",
        noticeVersion: "v1",
        method: "EMAIL_PLUS",
        submittedAt: new Date(),
        verifiedAt: new Date(),
        withdrawnAt: null,
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([{ id: "user_1", email: "parent@example.com" }]);

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: true });
    expect(storage.del).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      "upload.updateMany(SOURCE_DELETED)",
      "storage.del",
      "parentalConsent.deleteMany",
      "studentProfile.delete",
    ]);
  });

  it("skips the blob step entirely when there are no Upload rows, and still deletes the profile row", async () => {
    dbMock.upload.findMany.mockResolvedValue([]);
    const storage = fakeStorage();

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: true });
    expect(dbMock.upload.updateMany).not.toHaveBeenCalled();
    expect(storage.del).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.delete).toHaveBeenCalledWith({ where: { id: "sp_1" } });
  });

  it("reads the FULL pathname set unfiltered by status (so a retry cannot lose objects), but only marks not-yet-marked rows", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/b.jpg" }]);
    const storage = fakeStorage();

    await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    // Step 1 must NOT filter on `status` — see the docstring on
    // `deleteStudentData` for why filtering here is the bug that orphans
    // blobs on retry.
    expect(dbMock.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentProfileId: "sp_1" },
      }),
    );
    // Step 2's *mark* is still scoped to not-yet-marked rows, so a retry
    // doesn't re-stamp `sourceDeletedAt` on rows a prior attempt already
    // marked.
    expect(dbMock.upload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentProfileId: "sp_1", status: { not: "SOURCE_DELETED" } },
        data: expect.objectContaining({ status: "SOURCE_DELETED" }),
      }),
    );
  });
});

describe("deleteStudentData — retry after STORAGE_FAILURE must not orphan blobs (regression)", () => {
  /**
   * A stateful fake `Upload` table, standing in for what a real Postgres
   * table does: `findMany`/`updateMany` actually apply the `status` filter
   * from `where`, and `updateMany` actually persists the mutation. A naive
   * stub that always resolves the same fixed array (as used elsewhere in
   * this file) cannot catch this bug — it would return the same pathnames
   * on both calls regardless of what `where` the production code passed,
   * masking exactly the defect this test exists to catch.
   */
  function makeUploadTable(initial: Array<{ pathname: string; status: string }>) {
    const rows = initial.map((row) => ({ ...row }));
    return {
      rows,
      findMany: vi.fn(
        async ({ where }: { where: { studentProfileId: string; status?: { not: string } } }) => {
          const filtered = where.status?.not
            ? rows.filter((row) => row.status !== where.status!.not)
            : rows;
          return filtered.map((row) => ({ pathname: row.pathname }));
        },
      ),
      updateMany: vi.fn(
        async ({ where }: { where: { studentProfileId: string; status?: { not: string } } }) => {
          let count = 0;
          for (const row of rows) {
            if (where.status?.not && row.status === where.status.not) continue;
            row.status = "SOURCE_DELETED";
            count += 1;
          }
          return { count };
        },
      ),
    };
  }

  it("calls storage.del() with the same full pathname set on retry, and only destroys the profile once bytes are confirmed gone", async () => {
    const table = makeUploadTable([
      { pathname: "students/sp_1/uploads/a.jpg", status: "PENDING" },
      { pathname: "students/sp_1/uploads/b.jpg", status: "PENDING" },
    ]);
    dbMock.upload.findMany.mockImplementation(table.findMany);
    dbMock.upload.updateMany.mockImplementation(table.updateMany);

    const expectedPathnames = ["students/sp_1/uploads/a.jpg", "students/sp_1/uploads/b.jpg"];

    // First attempt: storage.del() rejects.
    const failingStorage = fakeStorage({
      del: async () => {
        throw new Error("simulated provider outage");
      },
    });
    const firstResult = await deleteStudentData("sp_1", "PROFILE_DELETED", failingStorage);

    expect(firstResult).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(failingStorage.del).toHaveBeenCalledWith(expectedPathnames);
    expect(dbMock.studentProfile.delete).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();

    // Second attempt (the retry): storage.del() now succeeds.
    const succeedingStorage = fakeStorage();
    const secondResult = await deleteStudentData("sp_1", "PROFILE_DELETED", succeedingStorage);

    expect(secondResult).toEqual({ ok: true });
    // The point of this test: the retry must call del() with the SAME full
    // set, not an empty array. The unfixed implementation filters step 1's
    // `findMany` on `status: { not: "SOURCE_DELETED" }`, so after the first
    // call's `updateMany` marks every row, this second call's `findMany`
    // resolves to `[]`, `storage.del()` is never called again, and the
    // profile is destroyed with its blobs never actually deleted — an
    // orphan.
    expect(succeedingStorage.del).toHaveBeenCalledWith(expectedPathnames);
    // The profile is only destroyed on the attempt where the bytes are
    // actually confirmed gone.
    expect(dbMock.studentProfile.delete).toHaveBeenCalledTimes(1);
    expect(dbMock.studentProfile.delete).toHaveBeenCalledWith({ where: { id: "sp_1" } });
  });
});

describe("deleteStudentData — a storage failure destroys nothing (ADR-0007 §1)", () => {
  it("returns STORAGE_FAILURE and never runs the row-destroying transaction when storage.del() rejects", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/a.jpg" }]);
    const storage = fakeStorage({
      del: async () => {
        throw new Error("simulated provider outage");
      },
    });

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    // The dangling-reference half already committed (retryable)...
    expect(dbMock.upload.updateMany).toHaveBeenCalledTimes(1);
    // ...but nothing past that point ran: no pseudonymisation, no audit
    // row, no consent deletion, no profile deletion, no transaction at all.
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.consentAuditArtifact.createMany).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.deleteMany).not.toHaveBeenCalled();
    expect(dbMock.deletionAudit.create).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.delete).not.toHaveBeenCalled();
  });

  it("does not throw — callers rely on the discriminated result, never a caught exception", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "x" }]);
    const storage = fakeStorage({
      del: async () => {
        throw new Error("boom");
      },
    });

    await expect(deleteStudentData("sp_1", "PARENTAL_DELETION_REQUEST", storage)).resolves.toEqual({
      ok: false,
      code: "STORAGE_FAILURE",
    });
  });
});

describe("deleteStudentData — consent pseudonymisation (ADR-0007 §6, AC 50)", () => {
  it("writes one ConsentAuditArtifact per ParentalConsent row, with no name/relationship/IP/user-agent/foreign key, before deleting the consent rows", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const verifiedAt = new Date("2026-01-02T00:00:00.000Z");
    dbMock.parentalConsent.findMany.mockResolvedValue([
      {
        id: "consent_1",
        userId: "user_1",
        studentProfileId: "sp_1",
        consentTextVersion: "2026-08-26.1",
        noticeVersion: "2026-08-26.1",
        method: "EMAIL_PLUS",
        submittedAt,
        verifiedAt,
        withdrawnAt: null,
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([{ id: "user_1", email: "parent@example.com" }]);
    const storage = fakeStorage();

    const result = await deleteStudentData("sp_1", "PARENTAL_DELETION_REQUEST", storage);

    expect(result).toEqual({ ok: true });
    expect(dbMock.consentAuditArtifact.createMany).toHaveBeenCalledTimes(1);
    const artifact = (
      dbMock.consentAuditArtifact.createMany.mock.calls[0][0] as {
        data: Array<Record<string, unknown>>;
      }
    ).data[0];
    expect(artifact).toMatchObject({
      consentTextVersion: "2026-08-26.1",
      noticeVersion: "2026-08-26.1",
      method: "EMAIL_PLUS",
      submittedAt,
      verifiedAt,
      withdrawnAt: null,
    });
    expect(artifact).not.toHaveProperty("studentProfileId");
    expect(artifact).not.toHaveProperty("consentingAdultName");
    expect(artifact).not.toHaveProperty("relationship");
    expect(artifact).not.toHaveProperty("ipAddress");
    expect(artifact).not.toHaveProperty("userAgent");
    expect(typeof artifact.adultIdentityHash).toBe("string");
    expect(artifact.adultIdentityHash).not.toBe("parent@example.com");

    expect(dbMock.parentalConsent.deleteMany).toHaveBeenCalledWith({ where: { studentProfileId: "sp_1" } });
    expect(dbMock.deletionAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "PARENTAL_DELETION_REQUEST", subjectRef: "sp_1" }),
    });
  });

  it("writes no ConsentAuditArtifact and skips the consent deleteMany when there is no consent history", async () => {
    dbMock.parentalConsent.findMany.mockResolvedValue([]);
    const storage = fakeStorage();

    await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(dbMock.consentAuditArtifact.createMany).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.deleteMany).not.toHaveBeenCalled();
    expect(dbMock.deletionAudit.create).toHaveBeenCalledTimes(1);
    expect(dbMock.studentProfile.delete).toHaveBeenCalledWith({ where: { id: "sp_1" } });
  });
});

/**
 * M5 §7.2. Before `PROFILE_BLOB_SOURCES`, step 1 read only `db.upload`, so a
 * profile whose only blobs were narration audio (ADR-0015's per-profile
 * cache) had those objects left behind in storage forever — invisible to
 * every test that only checked the DATABASE afterward, because the
 * `NarrationAsset` ROWS still cascade away with the `StudentProfile` delete
 * regardless. These tests assert what `storage.del()` is actually called
 * with, which is the only place the old gap was visible.
 */
describe("deleteStudentData — narration blobs (M5 §7.2, AC 20 / M0 AC 46-48)", () => {
  it("reads NarrationAsset pathnames alongside Upload pathnames and deletes both from storage", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/a.jpg" }]);
    dbMock.narrationAsset.findMany.mockResolvedValue([
      { pathname: "students/sp_1/narration/one.mp3" },
      { pathname: "students/sp_1/narration/two.mp3" },
    ]);
    const storage = fakeStorage();

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: true });
    expect(storage.del).toHaveBeenCalledTimes(1);
    const [deletedPathnames] = storage.del.mock.calls[0] as [string[]];
    expect(new Set(deletedPathnames)).toEqual(
      new Set([
        "students/sp_1/uploads/a.jpg",
        "students/sp_1/narration/one.mp3",
        "students/sp_1/narration/two.mp3",
      ]),
    );
  });

  it("deletes narration blobs even when the profile has zero Upload rows", async () => {
    dbMock.upload.findMany.mockResolvedValue([]);
    dbMock.narrationAsset.findMany.mockResolvedValue([{ pathname: "students/sp_1/narration/only.mp3" }]);
    const storage = fakeStorage();

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: true });
    expect(storage.del).toHaveBeenCalledWith(["students/sp_1/narration/only.mp3"]);
    // No Upload rows means no SOURCE_DELETED mark to write — see the
    // docstring on `deleteStudentData` for why NarrationAsset has no
    // equivalent mark.
    expect(dbMock.upload.updateMany).not.toHaveBeenCalled();
  });

  it("a storage failure deleting ONLY narration blobs still returns STORAGE_FAILURE and destroys no row", async () => {
    dbMock.upload.findMany.mockResolvedValue([]);
    dbMock.narrationAsset.findMany.mockResolvedValue([{ pathname: "students/sp_1/narration/only.mp3" }]);
    const storage = fakeStorage({
      del: async () => {
        throw new Error("simulated provider outage");
      },
    });

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.delete).not.toHaveBeenCalled();
  });
});
