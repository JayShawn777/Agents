import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Endpoint 13 (plan §3.2) — `POST /api/account/closure` (ADR-0007 §4(c)).
 * The distinguishing behaviour this suite exists to prove: closure sets
 * `closureRequestedAt`, deletes sessions, and writes a `DeletionAudit` with
 * NO `completedAt` — and it NEVER calls `deleteStudentData`. That call is
 * the thing endpoint 6 (`data-deletion-route.test.ts`) proves happens
 * immediately instead; the two must not converge.
 */

const SESSION = { userId: "user_1" };

const dbMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  session: { deleteMany: vi.fn() },
  deletionAudit: { create: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

const dalMock = {
  verifySession: vi.fn(async () => SESSION as { userId: string } | null),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth/dal", () => dalMock);

const { POST } = await import("@/app/api/account/closure/route");
const { ACCOUNT_CLOSURE_RECOVERY_DAYS } = await import("@/lib/config");

function req(body: unknown) {
  return new Request("http://localhost/api/account/closure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx() {
  return { params: Promise.resolve({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue(SESSION);
  dbMock.user.findUnique.mockResolvedValue({ id: "user_1", closureRequestedAt: null });
});

describe("POST /api/account/closure", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    const res = await POST(req({ confirm: true }), ctx());
    expect(res.status).toBe(401);
  });

  it("400s on a missing confirm field, before touching the database's write path", async () => {
    const res = await POST(req({}), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("409s if the account is already closing, even with a valid body", async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: "user_1", closureRequestedAt: new Date() });
    const res = await POST(req({ confirm: true }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("sets closureRequestedAt, deletes every Session row, and writes a DeletionAudit with no completedAt", async () => {
    const res = await POST(req({ confirm: true }), ctx());
    const body = (await res.json()) as {
      ok: true;
      data: { closureRequestedAt: string; purgeAfter: string; recoveryWindowDays: number };
    };

    expect(res.status).toBe(202);
    expect(body.data.recoveryWindowDays).toBe(ACCOUNT_CLOSURE_RECOVERY_DAYS);
    expect(new Date(body.data.purgeAfter).getTime()).toBeGreaterThan(
      new Date(body.data.closureRequestedAt).getTime(),
    );

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { closureRequestedAt: expect.any(Date) },
    });
    expect(dbMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });

    const auditCall = dbMock.deletionAudit.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(auditCall.data).toMatchObject({ kind: "ACCOUNT_CLOSURE", subjectRef: "user_1" });
    expect(auditCall.data).not.toHaveProperty("completedAt");
  });

  it("never imports deleteStudentData — closure is soft, not immediate destruction (ADR-0007 §4)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../../../../app/api/account/closure/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from ["']@\/lib\/deletion\/service["']/);
  });
});
