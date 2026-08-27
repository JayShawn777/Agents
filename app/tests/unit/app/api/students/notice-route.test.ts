import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "user_1" };

const dbMock = {
  user: { findUniqueOrThrow: vi.fn(async () => ({ id: "user_1", email: "parent@example.com" })) },
};

const dalMock = {
  verifySession: vi.fn(async () => SESSION as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};

const submitNoticeMock = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth/dal", () => dalMock);
vi.mock("@/lib/notice/service", () => ({ submitNotice: submitNoticeMock }));

const { POST } = await import("@/app/api/students/[studentId]/notice/route");
const { DIRECT_NOTICE_VERSION } = await import("@/lib/notice/copy");

function req(body: unknown) {
  return new Request("http://localhost/api/students/sp_1/notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(studentId = "sp_1") {
  return { params: Promise.resolve({ studentId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue(SESSION);
  dalMock.requireStudentProfile.mockResolvedValue({ id: "sp_1", status: "NOTICE_PENDING" });
});

describe("POST /api/students/[studentId]/notice (endpoint 7)", () => {
  it("404s for a cross-account or nonexistent profile", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const res = await POST(req({ noticeVersion: DIRECT_NOTICE_VERSION, acknowledged: true }), ctx());
    expect(res.status).toBe(404);
    expect(submitNoticeMock).not.toHaveBeenCalled();
  });

  it("400s on a malformed body", async () => {
    const res = await POST(req({ acknowledged: true }), ctx());
    expect(res.status).toBe(400);
  });

  it("409s when submitNotice reports a stale version", async () => {
    submitNoticeMock.mockResolvedValue({ ok: false, code: "STALE_VERSION" });
    const res = await POST(req({ noticeVersion: "1999-01-01.1", acknowledged: true }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("502s when the notice was written but email dispatch failed (sentAt null)", async () => {
    submitNoticeMock.mockResolvedValue({
      ok: true,
      notice: { id: "notice_1", noticeVersion: DIRECT_NOTICE_VERSION, presentedAt: new Date(), sentAt: null },
    });
    const res = await POST(req({ noticeVersion: DIRECT_NOTICE_VERSION, acknowledged: true }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("201s with the DTO when the email was delivered", async () => {
    const sentAt = new Date("2026-01-01T00:00:00.000Z");
    submitNoticeMock.mockResolvedValue({
      ok: true,
      notice: { id: "notice_1", noticeVersion: DIRECT_NOTICE_VERSION, presentedAt: sentAt, sentAt },
    });
    const res = await POST(req({ noticeVersion: DIRECT_NOTICE_VERSION, acknowledged: true }), ctx());
    const body = (await res.json()) as { ok: true; data: { notice: { id: string; sentAt: string | null } } };
    expect(res.status).toBe(201);
    expect(body.data.notice.id).toBe("notice_1");
    expect(body.data.notice.sentAt).not.toBeNull();
  });

  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    const res = await POST(req({ noticeVersion: DIRECT_NOTICE_VERSION, acknowledged: true }), ctx());
    expect(res.status).toBe(401);
  });
});
