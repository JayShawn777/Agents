import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `app/api/uploads/[uploadId]/route.ts` (endpoints 16-17, M1 AC 33/34).
 */

const dalMock = { requireUpload: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const deleteUploadMock = vi.fn();
vi.mock("@/lib/uploads/delete-upload", () => ({ deleteUpload: deleteUploadMock }));
vi.mock("@/lib/storage/get-storage", () => ({ getStoragePort: () => ({}) }));

const { GET, DELETE } = await import("@/app/api/uploads/[uploadId]/route");

function req(method: string) {
  return new Request("http://localhost/api/uploads/upload_1", { method });
}
function ctx() {
  return { params: Promise.resolve({ uploadId: "upload_1" }) };
}

beforeEach(() => vi.clearAllMocks());

describe("GET", () => {
  it("404s for a cross-account or nonexistent upload (M1 AC 33)", async () => {
    dalMock.requireUpload.mockResolvedValue(null);
    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns the upload and extraction DTOs, with the problem count from the loaded _count", async () => {
    dalMock.requireUpload.mockResolvedValue({
      id: "upload_1",
      studentProfileId: "sp_1",
      originalFilename: "worksheet.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
      pageCount: null,
      status: "STORED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      extraction: {
        id: "extraction_1",
        uploadId: "upload_1",
        status: "COMPLETE",
        failureCode: null,
        completedAt: new Date("2026-01-01T00:01:00.000Z"),
        _count: { problems: 5 },
      },
    });

    const res = await GET(req("GET"), ctx());
    const body = (await res.json()) as { data: { extraction: { problemCount: number } } };

    expect(res.status).toBe(200);
    expect(body.data.extraction.problemCount).toBe(5);
  });

  it("returns extraction: null when the upload has none yet", async () => {
    dalMock.requireUpload.mockResolvedValue({
      id: "upload_1",
      studentProfileId: "sp_1",
      originalFilename: "worksheet.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
      pageCount: null,
      status: "PENDING",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      extraction: null,
    });

    const res = await GET(req("GET"), ctx());
    const body = (await res.json()) as { data: { extraction: null } };
    expect(body.data.extraction).toBeNull();
  });
});

describe("DELETE (M1 AC 34)", () => {
  it("404s cross-account and never calls deleteUpload", async () => {
    dalMock.requireUpload.mockResolvedValue(null);
    const res = await DELETE(req("DELETE"), ctx());
    expect(res.status).toBe(404);
    expect(deleteUploadMock).not.toHaveBeenCalled();
  });

  it("200s and reports deleted: true on success", async () => {
    dalMock.requireUpload.mockResolvedValue({ id: "upload_1", status: "STORED" });
    deleteUploadMock.mockResolvedValue({ ok: true });

    const res = await DELETE(req("DELETE"), ctx());
    const body = (await res.json()) as { data: { deleted: true } };

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it("502s (retryable) when the blob deletion fails, per ADR-0007 §1", async () => {
    dalMock.requireUpload.mockResolvedValue({ id: "upload_1", status: "STORED" });
    deleteUploadMock.mockResolvedValue({ ok: false, code: "STORAGE_FAILURE" });

    const res = await DELETE(req("DELETE"), ctx());
    expect(res.status).toBe(502);
  });
});
