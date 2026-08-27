import { beforeEach, expect, it, vi } from "vitest";

/**
 * `app/api/uploads/confirm/route.ts` (endpoint 15, B17). Confirms at the
 * HTTP layer what `tests/unit/lib/uploads/record-upload.test.ts` proves at
 * the library layer: ownership + ACTIVE are enforced even though
 * `studentProfileId` is body-derived (no path param for `withAuth()`'s usual
 * ordering to key off), and a repeated confirm returns 200 (not 201) for the
 * SAME upload rather than creating a second row (M1 AC 15).
 */

const SP_ID = "c000000000000000000000001";

const dalMock = {
  verifySession: vi.fn(async () => ({ userId: "user_1" }) as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const recordUploadMock = vi.fn();
vi.mock("@/lib/uploads/record-upload", () => ({ recordUpload: recordUploadMock }));

vi.mock("@/lib/storage/get-storage", () => ({ getStoragePort: () => ({}) }));

const { POST } = await import("@/app/api/uploads/confirm/route");

function ctx() {
  return { params: Promise.resolve({}) };
}

function confirmRequest(body: unknown) {
  return new Request("http://localhost/api/uploads/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  studentProfileId: SP_ID,
  pathname: `students/${SP_ID}/uploads/abc-123.jpg`,
  originalFilename: "worksheet.jpg",
};

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
});

it("404s for a cross-account or nonexistent studentProfileId", async () => {
  dalMock.requireStudentProfile.mockResolvedValue(null);

  const res = await POST(confirmRequest(VALID_BODY), ctx());

  expect(res.status).toBe(404);
  expect(recordUploadMock).not.toHaveBeenCalled();
});

it("403s for a non-ACTIVE (but owned) profile", async () => {
  dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "CONSENT_PENDING" });

  const res = await POST(confirmRequest(VALID_BODY), ctx());

  expect(res.status).toBe(403);
  expect(recordUploadMock).not.toHaveBeenCalled();
});

it("rejects a pathname outside the caller's own namespace even though the profile itself is owned", async () => {
  dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });

  const res = await POST(
    confirmRequest({ ...VALID_BODY, pathname: "students/c000000000000000000000099/uploads/abc-123.jpg" }),
    ctx(),
  );

  expect(res.status).toBe(400);
  expect(recordUploadMock).not.toHaveBeenCalled();
});

it("201s on first confirmation and 200s on a repeat — both returning the same upload/extraction (M1 AC 15)", async () => {
  dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });
  const upload = {
    id: "upload_1",
    studentProfileId: SP_ID,
    originalFilename: "worksheet.jpg",
    contentType: "image/jpeg",
    sizeBytes: 100,
    pageCount: null,
    status: "STORED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  recordUploadMock.mockResolvedValueOnce({ ok: true, upload, extractionId: "extraction_1", created: true });
  const first = await POST(confirmRequest(VALID_BODY), ctx());
  expect(first.status).toBe(201);

  recordUploadMock.mockResolvedValueOnce({ ok: true, upload, extractionId: "extraction_1", created: false });
  const second = await POST(confirmRequest(VALID_BODY), ctx());
  expect(second.status).toBe(200);

  const firstBody = (await first.json()) as { data: { extractionId: string } };
  const secondBody = (await second.json()) as { data: { extractionId: string } };
  expect(firstBody.data.extractionId).toBe(secondBody.data.extractionId);
});

it("states the page limit in the message when a PDF exceeds it (M1 AC 10)", async () => {
  dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });
  recordUploadMock.mockResolvedValue({ ok: false, code: "PDF_PAGE_LIMIT_EXCEEDED" });

  const res = await POST(confirmRequest(VALID_BODY), ctx());
  const body = (await res.json()) as { ok: false; error: { code: string; message: string } };

  expect(res.status).toBe(409);
  expect(body.error.message).toMatch(/20 pages/);
});

it("404s when the object hasn't landed in storage yet", async () => {
  dalMock.requireStudentProfile.mockResolvedValue({ id: SP_ID, status: "ACTIVE" });
  recordUploadMock.mockResolvedValue({ ok: false, code: "NOT_FOUND_IN_STORE" });

  const res = await POST(confirmRequest(VALID_BODY), ctx());

  expect(res.status).toBe(404);
});
