import { beforeEach, expect, it, vi } from "vitest";

/**
 * `lib/uploads/rate-limit.ts` (B16, M1 AC 17). A grant row is written only
 * for a request that PASSES the check — a refused request issues no token
 * and reserves nothing.
 */

const dbMock = {
  uploadTokenGrant: {
    count: vi.fn(),
    create: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { recordUploadTokenGrant } = await import("@/lib/uploads/rate-limit");

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.uploadTokenGrant.create.mockResolvedValue({ id: "grant_1" });
});

it("allows and records a grant under the hourly cap", async () => {
  dbMock.uploadTokenGrant.count.mockResolvedValue(9); // UPLOADS_PER_HOUR is 10

  const allowed = await recordUploadTokenGrant("sp_1", "students/sp_1/uploads/a.jpg");

  expect(allowed).toBe(true);
  expect(dbMock.uploadTokenGrant.create).toHaveBeenCalledWith({
    data: { studentProfileId: "sp_1", requestedPathname: "students/sp_1/uploads/a.jpg" },
  });
});

it("refuses at the cap and writes no grant row", async () => {
  dbMock.uploadTokenGrant.count.mockResolvedValue(10);

  const allowed = await recordUploadTokenGrant("sp_1", "students/sp_1/uploads/a.jpg");

  expect(allowed).toBe(false);
  expect(dbMock.uploadTokenGrant.create).not.toHaveBeenCalled();
});

it("counts only within the rolling one-hour window", async () => {
  dbMock.uploadTokenGrant.count.mockResolvedValue(0);

  await recordUploadTokenGrant("sp_1", "students/sp_1/uploads/a.jpg");

  const callArgs = dbMock.uploadTokenGrant.count.mock.calls[0][0] as {
    where: { studentProfileId: string; createdAt: { gte: Date } };
  };
  expect(callArgs.where.studentProfileId).toBe("sp_1");
  expect(Date.now() - callArgs.where.createdAt.gte.getTime()).toBeCloseTo(60 * 60 * 1000, -2);
});
