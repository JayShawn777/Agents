import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Endpoint 6 (plan §3.2) — `POST /api/students/[studentId]/data-deletion`,
 * the §312.6 parental deletion request (ADR-0007 §4(b)). Route-level unit
 * tests against a mocked `lib/deletion/service.ts` — the ordering and
 * pseudonymisation guarantees of `deleteStudentData` itself are covered by
 * `tests/unit/lib/deletion/service.test.ts`; this file proves the ROUTE
 * wires it up correctly: input validation, ownership scoping, the correct
 * `DeletionKind`, and the 502 mapping on a storage failure.
 */

const SESSION = { userId: "user_1" };

const dalMock = {
  verifySession: vi.fn(async () => SESSION as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};

const deleteStudentDataMock = vi.fn();
const getStoragePortMock = vi.fn(() => ({ fake: "storage-port" }));

vi.mock("@/lib/auth/dal", () => dalMock);
vi.mock("@/lib/deletion/service", () => ({ deleteStudentData: deleteStudentDataMock }));
vi.mock("@/lib/storage/get-storage", () => ({ getStoragePort: getStoragePortMock }));

const { POST } = await import("@/app/api/students/[studentId]/data-deletion/route");

function req(body: unknown) {
  return new Request("http://localhost/api/students/sp_1/data-deletion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(studentId = "sp_1") {
  return { params: Promise.resolve({ studentId }) };
}

const VALID_BODY = { confirm: true, acknowledgeIrreversible: true };

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue(SESSION);
  dalMock.requireStudentProfile.mockResolvedValue({ id: "sp_1", status: "ACTIVE" });
  deleteStudentDataMock.mockResolvedValue({ ok: true });
});

describe("POST /api/students/[studentId]/data-deletion", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    const res = await POST(req(VALID_BODY), ctx());
    expect(res.status).toBe(401);
    expect(deleteStudentDataMock).not.toHaveBeenCalled();
  });

  it("404s for a cross-account or nonexistent profile, and never calls deleteStudentData", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const res = await POST(req(VALID_BODY), ctx());
    expect(res.status).toBe(404);
    expect(deleteStudentDataMock).not.toHaveBeenCalled();
  });

  it("400s when confirm/acknowledgeIrreversible are missing, and never calls deleteStudentData", async () => {
    const res = await POST(req({ confirm: true }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(deleteStudentDataMock).not.toHaveBeenCalled();
  });

  it("calls deleteStudentData with kind PARENTAL_DELETION_REQUEST — never PROFILE_DELETED or ACCOUNT_CLOSURE", async () => {
    const res = await POST(req(VALID_BODY), ctx());
    const body = (await res.json()) as { ok: true; data: { deleted: true } };

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(deleteStudentDataMock).toHaveBeenCalledWith(
      "sp_1",
      "PARENTAL_DELETION_REQUEST",
      expect.anything(),
    );
  });

  it("maps a STORAGE_FAILURE result to 502 UPSTREAM_ERROR", async () => {
    deleteStudentDataMock.mockResolvedValue({ ok: false, code: "STORAGE_FAILURE" });
    const res = await POST(req(VALID_BODY), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("succeeds against a NOTICE_PENDING/CONSENT_PENDING profile too — no status gate on this route (AC 48/49: reachable at any step)", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "sp_1", status: "CONSENT_PENDING" });
    const res = await POST(req(VALID_BODY), ctx());
    expect(res.status).toBe(200);
  });
});
