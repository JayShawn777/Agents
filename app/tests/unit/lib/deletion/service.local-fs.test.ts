import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalFsStorage } from "@/lib/storage/local-fs";
import type { StoragePort } from "@/lib/storage/port";

/**
 * `service.test.ts` re-run against the REAL `LocalFsStorage` adapter
 * instead of the hand-rolled `fakeStorage()` in that file — proving the
 * blob-before-row ordering guarantee (ADR-0007 §1) and the retry-safety
 * regression against actual `unlink`/`readdir` semantics, not a mock. See
 * this task's report for what, if anything, differed from the fake.
 */

const dbMock = {
  upload: {
    findMany:
      vi.fn<(args: { where: { studentProfileId: string; status?: { not: string } } }) => Promise<Array<{ pathname: string }>>>(),
    updateMany: vi.fn(),
  },
  // M5 §7.2 — see tests/unit/lib/deletion/service.test.ts's own comment.
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

/** A real `LocalFsStorage` wrapped only to record `del()` calls; `del()` itself still does real filesystem work. */
function withDelSpy(storage: LocalFsStorage): StoragePort & { calls: string[][] } {
  const calls: string[][] = [];
  const port: StoragePort = {
    handleClientUpload: storage.handleClientUpload.bind(storage),
    head: storage.head.bind(storage),
    signedReadUrl: storage.signedReadUrl.bind(storage),
    readBytes: storage.readBytes.bind(storage),
    del: async (pathnames: string[]) => {
      calls.push(pathnames);
      await storage.del(pathnames);
    },
    put: storage.put.bind(storage),
    listAll: storage.listAll.bind(storage),
  };
  return Object.assign(port, { calls });
}

/** Same shape, but `del()` always rejects — simulates a provider outage without touching the real store. */
function withFailingDel(storage: LocalFsStorage): StoragePort {
  return {
    handleClientUpload: storage.handleClientUpload.bind(storage),
    head: storage.head.bind(storage),
    signedReadUrl: storage.signedReadUrl.bind(storage),
    readBytes: storage.readBytes.bind(storage),
    del: async () => {
      throw new Error("simulated provider outage");
    },
    put: storage.put.bind(storage),
    listAll: storage.listAll.bind(storage),
  };
}

let rootDir: string;
let real: LocalFsStorage;

beforeEach(async () => {
  vi.clearAllMocks();
  dbMock.upload.findMany.mockResolvedValue([]);
  dbMock.narrationAsset.findMany.mockResolvedValue([]);
  dbMock.parentalConsent.findMany.mockResolvedValue([]);
  dbMock.user.findMany.mockResolvedValue([]);
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "deletion-service-local-fs-"));
  real = new LocalFsStorage(rootDir);
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe("deleteStudentData against LocalFsStorage — blob-before-row ordering (ADR-0007 §1)", () => {
  it("marks Upload rows SOURCE_DELETED, then calls storage.del(), then deletes rows — and the bytes are actually gone afterward", async () => {
    await real.put("students/sp_1/uploads/a.jpg", new Uint8Array([1]), "image/jpeg");
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/a.jpg" }]);
    const callOrder: string[] = [];
    dbMock.upload.updateMany.mockImplementation(async () => {
      callOrder.push("upload.updateMany(SOURCE_DELETED)");
      return { count: 1 };
    });
    dbMock.parentalConsent.deleteMany.mockImplementation(async () => {
      callOrder.push("parentalConsent.deleteMany");
      return { count: 0 };
    });
    dbMock.studentProfile.delete.mockImplementation(async () => {
      callOrder.push("studentProfile.delete");
    });
    // Seed one consent row so `parentalConsent.deleteMany` actually runs —
    // matching `service.test.ts`'s equivalent case; with zero consent rows
    // that step is (correctly) skipped entirely.
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
    const storage = withDelSpy(real);
    const originalDel = storage.del.bind(storage);
    storage.del = async (pathnames) => {
      callOrder.push("storage.del");
      await originalDel(pathnames);
    };

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: true });
    expect(callOrder).toEqual([
      "upload.updateMany(SOURCE_DELETED)",
      "storage.del",
      "parentalConsent.deleteMany",
      "studentProfile.delete",
    ]);
    // Proven against the real store: the object is actually gone, not just
    // "a mock recorded a call".
    expect(await real.head("students/sp_1/uploads/a.jpg")).toBeNull();
  });

  it("reads the FULL pathname set unfiltered by status, and storage.del() removes exactly that set from the real store", async () => {
    await real.put("students/sp_1/uploads/b.jpg", new Uint8Array([1]), "image/jpeg");
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/b.jpg" }]);
    const storage = withDelSpy(real);

    await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(storage.calls).toEqual([["students/sp_1/uploads/b.jpg"]]);
    expect(await real.head("students/sp_1/uploads/b.jpg")).toBeNull();
  });
});

describe("deleteStudentData against LocalFsStorage — a storage failure destroys nothing and orphans nothing", () => {
  it("returns STORAGE_FAILURE, leaves the row-destroying transaction unrun, AND leaves the real object on disk untouched", async () => {
    await real.put("students/sp_1/uploads/a.jpg", new Uint8Array([1]), "image/jpeg");
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/a.jpg" }]);
    const storage = withFailingDel(real);

    const result = await deleteStudentData("sp_1", "PROFILE_DELETED", storage);

    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.delete).not.toHaveBeenCalled();
    // The object genuinely still exists — the failure was never allowed to
    // silently drop it.
    expect(await real.head("students/sp_1/uploads/a.jpg")).not.toBeNull();
  });
});

describe("deleteStudentData against LocalFsStorage — retry after STORAGE_FAILURE must not orphan blobs (regression)", () => {
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

  it("retries storage.del() with the same full pathname set and only destroys the profile once the real store confirms deletion", async () => {
    await real.put("students/sp_1/uploads/a.jpg", new Uint8Array([1]), "image/jpeg");
    await real.put("students/sp_1/uploads/b.jpg", new Uint8Array([1]), "image/jpeg");
    const table = makeUploadTable([
      { pathname: "students/sp_1/uploads/a.jpg", status: "PENDING" },
      { pathname: "students/sp_1/uploads/b.jpg", status: "PENDING" },
    ]);
    dbMock.upload.findMany.mockImplementation(table.findMany);
    dbMock.upload.updateMany.mockImplementation(table.updateMany);

    const expectedPathnames = ["students/sp_1/uploads/a.jpg", "students/sp_1/uploads/b.jpg"];

    // First attempt: storage.del() rejects — the real objects must survive.
    const failingStorage = withFailingDel(real);
    const firstResult = await deleteStudentData("sp_1", "PROFILE_DELETED", failingStorage);

    expect(firstResult).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(dbMock.studentProfile.delete).not.toHaveBeenCalled();
    expect(await real.head("students/sp_1/uploads/a.jpg")).not.toBeNull();
    expect(await real.head("students/sp_1/uploads/b.jpg")).not.toBeNull();

    // Second attempt (the retry): the real store now actually deletes.
    const succeedingStorage = withDelSpy(real);
    const secondResult = await deleteStudentData("sp_1", "PROFILE_DELETED", succeedingStorage);

    expect(secondResult).toEqual({ ok: true });
    expect(succeedingStorage.calls).toEqual([expectedPathnames]);
    expect(dbMock.studentProfile.delete).toHaveBeenCalledTimes(1);
    expect(await real.head("students/sp_1/uploads/a.jpg")).toBeNull();
    expect(await real.head("students/sp_1/uploads/b.jpg")).toBeNull();
  });
});
