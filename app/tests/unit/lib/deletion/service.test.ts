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
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
    updateMany: vi.fn(),
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.upload.findMany.mockResolvedValue([]);
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

  it("excludes already-SOURCE_DELETED uploads from the blob-deletion pathname set (retry-safe)", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/b.jpg" }]);
    const storage = fakeStorage();

    await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(dbMock.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentProfileId: "sp_1", status: { not: "SOURCE_DELETED" } },
      }),
    );
    expect(dbMock.upload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentProfileId: "sp_1", status: { not: "SOURCE_DELETED" } },
        data: expect.objectContaining({ status: "SOURCE_DELETED" }),
      }),
    );
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
