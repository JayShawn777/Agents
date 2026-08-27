import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

/**
 * `lib/uploads/record-upload.ts` (B17, endpoint 15, ADR-0003 step 5). The
 * load-bearing property this suite proves: `contentType`/`sizeBytes` come
 * from `storage.head()` and NEVER from a client-supplied value (this module
 * doesn't even accept one), and a confirmation delivered twice — either as a
 * genuine retry or a race with the `blob.upload-completed` backstop — writes
 * exactly one `Upload` row (M1 AC 13, AC 15).
 */

const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: afterMock }));

const dbMock = {
  upload: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  extraction: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const runExtractionMock = vi.fn(async () => ({ status: "SKIPPED" as const }));
vi.mock("@/lib/extraction/run-extraction", () => ({ runExtraction: runExtractionMock }));

const { recordUpload } = await import("@/lib/uploads/record-upload");
const { Prisma } = await import("@/lib/generated/prisma/client");

function fakeStorage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    handleClientUpload: vi.fn(),
    head: vi.fn(async () => ({ contentType: "image/jpeg", sizeBytes: 12345 })),
    signedReadUrl: vi.fn(),
    readBytes: vi.fn(async () => new ArrayBuffer(8)),
    del: vi.fn(),
    listAll: vi.fn(),
    ...overrides,
  };
}

async function pdfBytesWithPages(count: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage();
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const ARGS = {
  studentProfileId: "sp_1",
  pathname: "students/sp_1/uploads/a-b-c.jpg",
  originalFilename: "worksheet.jpg",
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.upload.findUnique.mockResolvedValue(null);
  dbMock.upload.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "upload_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    extractedAt: null,
    sourceDeletedAt: null,
    ...data,
  }));
  dbMock.extraction.create.mockResolvedValue({ id: "extraction_1", uploadId: "upload_1", status: "PENDING" });
});

describe("recordUpload — storage.head() is the trust boundary", () => {
  it("writes the Upload row's contentType/sizeBytes from storage.head(), not from any client-supplied value", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ contentType: "image/png", sizeBytes: 999 })) });

    const result = await recordUpload({ ...ARGS, storage });

    expect(result.ok).toBe(true);
    expect(dbMock.upload.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentType: "image/png", sizeBytes: 999 }) }),
    );
  });

  it("rejects a content type storage reports that isn't on the allowlist", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ contentType: "text/plain", sizeBytes: 10 })) });

    const result = await recordUpload({ ...ARGS, storage });

    expect(result).toEqual({ ok: false, code: "DISALLOWED_CONTENT_TYPE" });
    expect(dbMock.upload.create).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND_IN_STORE when the object doesn't exist yet (head() -> null)", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => null) });

    const result = await recordUpload({ ...ARGS, storage });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND_IN_STORE" });
    expect(dbMock.upload.create).not.toHaveBeenCalled();
  });

  it("rejects a PDF over the configured page limit and never creates a row", async () => {
    const bytes = await pdfBytesWithPages(25); // PDF_PAGE_LIMIT is 20
    const storage = fakeStorage({
      head: vi.fn(async () => ({ contentType: "application/pdf", sizeBytes: bytes.byteLength })),
      readBytes: vi.fn(async () => bytes),
    });

    const result = await recordUpload({ ...ARGS, pathname: "students/sp_1/uploads/a.pdf", storage });

    expect(result).toEqual({ ok: false, code: "PDF_PAGE_LIMIT_EXCEEDED" });
    expect(dbMock.upload.create).not.toHaveBeenCalled();
  });

  it("accepts a PDF within the page limit and records the page count", async () => {
    const bytes = await pdfBytesWithPages(5);
    const storage = fakeStorage({
      head: vi.fn(async () => ({ contentType: "application/pdf", sizeBytes: bytes.byteLength })),
      readBytes: vi.fn(async () => bytes),
    });

    const result = await recordUpload({ ...ARGS, pathname: "students/sp_1/uploads/a.pdf", storage });

    expect(result.ok).toBe(true);
    expect(dbMock.upload.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pageCount: 5 }) }),
    );
  });
});

describe("recordUpload — idempotency (M1 AC 15)", () => {
  it("a pathname already recorded returns the existing row, created:false, and creates nothing new", async () => {
    dbMock.upload.findUnique.mockResolvedValue({
      id: "upload_existing",
      pathname: ARGS.pathname,
      extraction: { id: "extraction_existing" },
    });
    const storage = fakeStorage();

    const result = await recordUpload({ ...ARGS, storage });

    expect(result).toEqual(
      expect.objectContaining({ ok: true, created: false, extractionId: "extraction_existing" }),
    );
    expect(dbMock.upload.create).not.toHaveBeenCalled();
    expect(dbMock.extraction.create).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("a P2002 unique-constraint race (a concurrent confirm for the same pathname) is caught and re-read, not thrown", async () => {
    const storage = fakeStorage();
    dbMock.upload.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    // The re-read after losing the race.
    dbMock.upload.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "upload_raced",
      pathname: ARGS.pathname,
      extraction: { id: "extraction_raced" },
    });

    const result = await recordUpload({ ...ARGS, storage });

    expect(result).toEqual(
      expect.objectContaining({ ok: true, created: false, extractionId: "extraction_raced" }),
    );
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("schedules extraction via after() only on a genuine first creation", async () => {
    const storage = fakeStorage();

    const result = await recordUpload({ ...ARGS, storage });

    expect(result).toEqual(expect.objectContaining({ ok: true, created: true, extractionId: "extraction_1" }));
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
