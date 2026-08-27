import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { validateFileForUpload } from "@/lib/uploads/client-validate";
import { MAX_UPLOAD_BYTES, PDF_PAGE_LIMIT } from "@/lib/config";

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];

function heicHeader(): number[] {
  const bytes = new Array(12).fill(0);
  [...Buffer.from("ftyp")].forEach((b, i) => (bytes[4 + i] = b));
  [...Buffer.from("heic")].forEach((b, i) => (bytes[8 + i] = b));
  return bytes;
}

function jpegFile(sizeBytes = JPEG_HEADER.length): File {
  const bytes = new Uint8Array(sizeBytes);
  JPEG_HEADER.forEach((b, i) => (bytes[i] = b));
  return new File([bytes], "photo.jpg", { type: "image/jpeg" });
}

function heicFile(): File {
  return new File([new Uint8Array(heicHeader())], "photo.heic", { type: "image/heic" });
}

async function pdfFileWithPages(count: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage();
  const bytes = await doc.save();
  // See tests/unit/lib/uploads/pdf-page-count.test.ts for why this slice is
  // needed rather than passing `bytes` directly.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([arrayBuffer], "worksheet.pdf", { type: "application/pdf" });
}

describe("validateFileForUpload", () => {
  it("accepts a well-formed JPEG with no conversion needed", async () => {
    const result = await validateFileForUpload(jpegFile());
    expect(result).toEqual({ ok: true, kind: "image/jpeg", needsHeicConversion: false, pageCount: null });
  });

  it("accepts a HEIC file and flags that it needs conversion", async () => {
    const result = await validateFileForUpload(heicFile());
    expect(result).toEqual({ ok: true, kind: "image/heic", needsHeicConversion: true, pageCount: null });
  });

  it("accepts a PDF within the page limit and reports its page count", async () => {
    const result = await validateFileForUpload(await pdfFileWithPages(3));
    expect(result).toEqual({ ok: true, kind: "application/pdf", needsHeicConversion: false, pageCount: 3 });
  });

  /**
   * M1 AC 6: shown before any bytes are transmitted. This function never
   * makes a network call at all, but the size check is asserted to run
   * BEFORE the (slightly more expensive) magic-byte sniff by using a file
   * whose bytes wouldn't sniff as anything valid — if size weren't checked
   * first, this would fail as UNSUPPORTED_TYPE instead of TOO_LARGE.
   */
  it("rejects an oversized file as TOO_LARGE, checked before the type sniff", async () => {
    const oversized = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.bin", {
      type: "application/octet-stream",
    });
    const result = await validateFileForUpload(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TOO_LARGE");
      expect(result.message).toMatch(/largest file/i);
    }
  });

  it("accepts a file exactly at the size limit", async () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES);
    JPEG_HEADER.forEach((b, i) => (bytes[i] = b));
    const result = await validateFileForUpload(new File([bytes], "photo.jpg", { type: "image/jpeg" }));
    expect(result.ok).toBe(true);
  });

  /** M1 AC 7: rejected with a message naming the accepted formats. */
  it("rejects an unsupported file type and names the accepted formats", async () => {
    const textFile = new File([new TextEncoder().encode("just some notes")], "notes.txt", {
      type: "text/plain",
    });
    const result = await validateFileForUpload(textFile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNSUPPORTED_TYPE");
      expect(result.message).toMatch(/JPEG/);
      expect(result.message).toMatch(/PDF/);
    }
  });

  /** M1 AC 10: rejected with a message stating the page limit. */
  it("rejects a PDF over the page limit and states the limit", async () => {
    const result = await validateFileForUpload(await pdfFileWithPages(PDF_PAGE_LIMIT + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TOO_MANY_PAGES");
      expect(result.message).toContain(String(PDF_PAGE_LIMIT));
    }
  });

  it("accepts a PDF exactly at the page limit", async () => {
    const result = await validateFileForUpload(await pdfFileWithPages(PDF_PAGE_LIMIT));
    expect(result.ok).toBe(true);
  });

  it("rejects an unreadable PDF", async () => {
    const bogusPdf = new File([new TextEncoder().encode("%PDF-1.4 but not actually valid")], "bad.pdf", {
      type: "application/pdf",
    });
    const result = await validateFileForUpload(bogusPdf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNREADABLE_FILE");
  });

  /** A HEIC file renamed to .jpg is still validated as HEIC (M1 AC 4), end to end through this orchestrator. */
  it("detects a mislabelled HEIC file end-to-end through validateFileForUpload", async () => {
    const mislabelled = new File([new Uint8Array(heicHeader())], "vacation.jpg", { type: "image/jpeg" });
    const result = await validateFileForUpload(mislabelled);
    expect(result).toEqual({ ok: true, kind: "image/heic", needsHeicConversion: true, pageCount: null });
  });
});
