import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0006's whole security argument — "authorization is a `where` clause,
 * never a check" — rests on `requireStudentProfile` actually scoping its
 * `db.studentProfile.findFirst` call by `userId`. The route-handler test
 * suite (`tests/unit/app/api/students/route.test.ts`) mocks `@/lib/auth/dal`
 * wholesale, so it stays green even if the `userId` clause is deleted from
 * this file. This suite is the one place that imports the REAL
 * `lib/auth/dal.ts` and mocks only `@/lib/db` underneath it, so a regression
 * here is caught where it actually lives.
 */

const dbMock = {
  studentProfile: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const authMock = { auth: vi.fn() };
vi.mock("@/lib/auth/config", () => authMock);

const { verifySession, requireStudentProfile, requireActiveStudentProfile } = await import(
  "@/lib/auth/dal"
);

beforeEach(() => {
  vi.clearAllMocks();
  // Not inside the closure recovery window by default — every existing
  // test below asserts behaviour for a live, non-closing account.
  dbMock.user.findUnique.mockResolvedValue({ closureRequestedAt: null });
});

describe("verifySession()", () => {
  it("returns null when there is no session", async () => {
    authMock.auth.mockResolvedValue(null);
    await expect(verifySession()).resolves.toBeNull();
  });

  it("returns null when the session carries no user id", async () => {
    authMock.auth.mockResolvedValue({ user: {} });
    await expect(verifySession()).resolves.toBeNull();
  });

  it("returns the userId from a real session", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    await expect(verifySession()).resolves.toEqual({ userId: "user_1" });
  });

  it("AC 47: refuses a session for an account still inside its closure recovery window, even though the Session row/cookie is otherwise valid", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    dbMock.user.findUnique.mockResolvedValue({
      closureRequestedAt: new Date(), // requested just now — squarely inside the window
    });

    await expect(verifySession()).resolves.toBeNull();
    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: { closureRequestedAt: true },
    });
  });

  it("allows a session once the closure recovery window has fully elapsed", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    dbMock.user.findUnique.mockResolvedValue({
      closureRequestedAt: new Date("2000-01-01T00:00:00.000Z"), // long past any recovery window
    });

    await expect(verifySession()).resolves.toEqual({ userId: "user_1" });
  });

  it("returns null when the user row backing the session id no longer exists", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    dbMock.user.findUnique.mockResolvedValue(null);

    await expect(verifySession()).resolves.toBeNull();
  });
});

describe("requireStudentProfile() — the authorization boundary", () => {
  it("returns null with no session, and never queries the database", async () => {
    authMock.auth.mockResolvedValue(null);
    const result = await requireStudentProfile("sp_1");
    expect(result).toBeNull();
    expect(dbMock.studentProfile.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the lookup by BOTH id and the calling user's id — deleting `userId` from this clause would let any account read any child's profile", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    dbMock.studentProfile.findFirst.mockResolvedValue({ id: "sp_1", userId: "user_1" });

    await requireStudentProfile("sp_1");

    expect(dbMock.studentProfile.findFirst).toHaveBeenCalledWith({
      where: { id: "sp_1", userId: "user_1" },
    });
  });

  it("returns whatever the scoped query returns — null for a cross-account or nonexistent id, indistinguishable (AC 32)", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    dbMock.studentProfile.findFirst.mockResolvedValue(null);

    await expect(requireStudentProfile("sp_owned_by_someone_else")).resolves.toBeNull();
  });
});

describe("requireActiveStudentProfile()", () => {
  it("returns null when the profile is not ACTIVE", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    dbMock.studentProfile.findFirst.mockResolvedValue({
      id: "sp_1",
      userId: "user_1",
      status: "NOTICE_PENDING",
    });

    await expect(requireActiveStudentProfile("sp_1")).resolves.toBeNull();
  });

  it("returns the profile when it is ACTIVE and owned by the caller", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "user_1" } });
    const profile = { id: "sp_1", userId: "user_1", status: "ACTIVE" };
    dbMock.studentProfile.findFirst.mockResolvedValue(profile);

    await expect(requireActiveStudentProfile("sp_1")).resolves.toEqual(profile);
  });
});
