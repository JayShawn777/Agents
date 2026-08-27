import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `app/api/blob/upload/route.ts` (endpoint 14, ADR-0003). The load-bearing
 * property the ADR's revision note calls out: the ACTIVE gate must be
 * tested POSITIVELY — every status other than exactly `ACTIVE` is refused —
 * never as a denylist of the three known-bad statuses.
 */

const SP_ID = "c000000000000000000000001";
const OTHER_SP_ID = "c000000000000000000000002";

const dalMock = {
  verifySession: vi.fn(async () => ({ userId: "user_1" }) as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const handleClientUploadMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
vi.mock("@/lib/storage/get-storage", () => ({
  getStoragePort: () => ({ handleClientUpload: handleClientUploadMock }),
}));

const recordUploadTokenGrantMock = vi.fn(async () => true);
vi.mock("@/lib/uploads/rate-limit", () => ({ recordUploadTokenGrant: recordUploadTokenGrantMock }));

const { POST } = await import("@/app/api/blob/upload/route");

function tokenRequest(pathname: string, clientPayload: unknown) {
  return new Request("http://localhost/api/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: JSON.stringify(clientPayload) },
    }),
  });
}

function completedCallback() {
  return new Request("http://localhost/api/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.upload-completed",
      payload: { blob: { pathname: `students/${SP_ID}/uploads/a.jpg`, contentType: "image/jpeg" } },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  recordUploadTokenGrantMock.mockResolvedValue(true);
});

describe("blob.generate-client-token — the ACTIVE gate is tested POSITIVELY", () => {
  it("issues a token for an ACTIVE, owned profile", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });

    const res = await POST(
      tokenRequest(`students/${SP_ID}/uploads/abc123.jpg`, {
        studentProfileId: SP_ID,
        originalFilename: "worksheet.jpg",
      }),
    );

    expect(res.status).toBe(200);
    expect(handleClientUploadMock).toHaveBeenCalledTimes(1);
  });

  it.each(["NOTICE_PENDING", "CONSENT_PENDING", "CONSENT_WITHDRAWN"])(
    "refuses (403) status %s — every non-ACTIVE status, not a fixed list of three",
    async (status) => {
      dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status });

      const res = await POST(
        tokenRequest(`students/${SP_ID}/uploads/abc123.jpg`, {
          studentProfileId: SP_ID,
          originalFilename: "worksheet.jpg",
        }),
      );

      expect(res.status).toBe(403);
      expect(handleClientUploadMock).not.toHaveBeenCalled();
    },
  );

  it("refuses (403) a FOURTH, hypothetical status this codebase doesn't even define yet — proving the check is positive, not a denylist", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "SOME_FUTURE_STATUS" });

    const res = await POST(
      tokenRequest(`students/${SP_ID}/uploads/abc123.jpg`, {
        studentProfileId: SP_ID,
        originalFilename: "worksheet.jpg",
      }),
    );

    expect(res.status).toBe(403);
    expect(handleClientUploadMock).not.toHaveBeenCalled();
  });

  it("refuses (403, not 404) a cross-account studentProfileId (M1 AC 12)", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);

    const res = await POST(
      tokenRequest(`students/${OTHER_SP_ID}/uploads/abc123.jpg`, {
        studentProfileId: OTHER_SP_ID,
        originalFilename: "worksheet.jpg",
      }),
    );

    expect(res.status).toBe(403);
    expect(handleClientUploadMock).not.toHaveBeenCalled();
  });

  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);

    const res = await POST(
      tokenRequest(`students/${SP_ID}/uploads/abc123.jpg`, {
        studentProfileId: SP_ID,
        originalFilename: "worksheet.jpg",
      }),
    );

    expect(res.status).toBe(401);
  });

  it("rejects a pathname that doesn't match the authorized profile's namespace", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });

    const res = await POST(
      tokenRequest(`students/${OTHER_SP_ID}/uploads/abc123.jpg`, {
        studentProfileId: SP_ID,
        originalFilename: "worksheet.jpg",
      }),
    );

    expect(res.status).toBe(400);
    expect(handleClientUploadMock).not.toHaveBeenCalled();
  });

  it("429s above the hourly cap and never delegates to storage", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });
    recordUploadTokenGrantMock.mockResolvedValue(false);

    const res = await POST(
      tokenRequest(`students/${SP_ID}/uploads/abc123.jpg`, {
        studentProfileId: SP_ID,
        originalFilename: "worksheet.jpg",
      }),
    );

    expect(res.status).toBe(429);
    expect(handleClientUploadMock).not.toHaveBeenCalled();
  });
});

describe("blob.upload-completed — the provider callback, no session required", () => {
  it("delegates straight to storage with no ownership/session check", async () => {
    const res = await POST(completedCallback());

    expect(res.status).toBe(200);
    expect(handleClientUploadMock).toHaveBeenCalledTimes(1);
    expect(dalMock.verifySession).not.toHaveBeenCalled();
    expect(dalMock.requireStudentProfile).not.toHaveBeenCalled();
  });
});
