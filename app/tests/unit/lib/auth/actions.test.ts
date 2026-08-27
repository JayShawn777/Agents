import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = {
  adultAttestation: {
    count: vi.fn(async () => 0),
    findFirst: vi.fn(async () => null as unknown),
    create: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const authConfigMock = {
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("@/lib/auth/config", () => authConfigMock);

// `lib/auth/actions.ts` imports `AuthError` directly from `next-auth`,
// which — like `NextAuth(...)` itself — reaches into `next/server` at
// module load in a way that doesn't resolve outside a real Next.js
// runtime. Mocked here purely so the import resolves; `instanceof
// AuthError` below still works against this mock class.
class MockAuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError: MockAuthError }));

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const { signInWithEmail } = await import("@/lib/auth/actions");

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.adultAttestation.count.mockResolvedValue(0);
  dbMock.adultAttestation.findFirst.mockResolvedValue(null);
  authConfigMock.signIn.mockResolvedValue(undefined);
  currentHeaders = new Headers({ "x-forwarded-for": "203.0.113.1", "user-agent": "vitest" });
});

describe("signInWithEmail() rate limiting (item 9)", () => {
  it("counts BOTH by normalised email and by IP before creating anything", async () => {
    await expect(
      signInWithEmail({ email: "Parent@Example.com", isAdult: true }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(dbMock.adultAttestation.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: "parent@example.com" }) }),
    );
    expect(dbMock.adultAttestation.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ipAddress: "203.0.113.1" }) }),
    );
  });

  it("returns success WITHOUT creating a row or dispatching an email once the per-email limit is reached — identical to a real success (AC 2)", async () => {
    dbMock.adultAttestation.count.mockResolvedValue(1000); // over any configured threshold

    const result = await signInWithEmail({ email: "victim@example.com", isAdult: true });

    expect(result).toEqual({ ok: true, data: { sent: true } });
    expect(dbMock.adultAttestation.create).not.toHaveBeenCalled();
    expect(authConfigMock.signIn).not.toHaveBeenCalled();
  });

  it("returns success WITHOUT creating a row or dispatching an email once the per-IP limit is reached", async () => {
    // Per-email count low, per-IP count high — either one alone must block.
    dbMock.adultAttestation.count
      .mockResolvedValueOnce(0) // email count
      .mockResolvedValueOnce(1000); // ip count

    const result = await signInWithEmail({ email: "victim2@example.com", isAdult: true });

    expect(result).toEqual({ ok: true, data: { sent: true } });
    expect(dbMock.adultAttestation.create).not.toHaveBeenCalled();
    expect(authConfigMock.signIn).not.toHaveBeenCalled();
  });

  it("does not throttle a normal, first-time request — it creates the attestation and dispatches", async () => {
    await expect(
      signInWithEmail({ email: "new-parent@example.com", isAdult: true }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(dbMock.adultAttestation.create).toHaveBeenCalledTimes(1);
    expect(authConfigMock.signIn).toHaveBeenCalledTimes(1);
  });
});

describe("signInWithEmail() upsert-with-cooldown (item 9)", () => {
  it("reuses an existing recent attestation instead of creating a new row within the cooldown window", async () => {
    dbMock.adultAttestation.findFirst.mockResolvedValue({
      id: "attestation_1",
      email: "parent@example.com",
      attestedAt: new Date(),
    });

    await expect(
      signInWithEmail({ email: "parent@example.com", isAdult: true }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(dbMock.adultAttestation.create).not.toHaveBeenCalled();
    // Still dispatches — the cooldown avoids row proliferation, not sign-in itself.
    expect(authConfigMock.signIn).toHaveBeenCalledTimes(1);
  });

  it("creates a new row when no recent attestation exists", async () => {
    dbMock.adultAttestation.findFirst.mockResolvedValue(null);

    await expect(
      signInWithEmail({ email: "parent2@example.com", isAdult: true }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(dbMock.adultAttestation.create).toHaveBeenCalledTimes(1);
  });
});
