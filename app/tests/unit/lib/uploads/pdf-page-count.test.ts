import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { getPdfPageCount, UnreadablePdfError } from "@/lib/uploads/pdf-page-count";

async function pdfFileWithPages(count: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    doc.addPage();
  }
  const bytes = await doc.save();
  // `Uint8Array.buffer` can be a larger, pooled `ArrayBufferLike` than this
  // view's own window (and pdf-lib's typings don't pin it to `ArrayBuffer`
  // specifically) — slice to exactly this array's bytes, the same idiom
  // `lib/storage/local-fs.ts`'s `bufferToArrayBuffer` uses.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([arrayBuffer], "worksheet.pdf", { type: "application/pdf" });
}

describe("getPdfPageCount", () => {
  it("counts a single-page PDF", async () => {
    expect(await getPdfPageCount(await pdfFileWithPages(1))).toBe(1);
  });

  it("counts a multi-page PDF", async () => {
    expect(await getPdfPageCount(await pdfFileWithPages(23))).toBe(23);
  });

  it("throws UnreadablePdfError for a file that doesn't parse as a PDF", async () => {
    const notAPdf = new File([new Uint8Array([1, 2, 3, 4, 5])], "not-a-pdf.pdf", {
      type: "application/pdf",
    });
    await expect(getPdfPageCount(notAPdf)).rejects.toBeInstanceOf(UnreadablePdfError);
  });

  it("UnreadablePdfError never leaks the underlying parser exception", async () => {
    const notAPdf = new File([new Uint8Array([0, 0, 0])], "garbage.pdf", { type: "application/pdf" });
    try {
      await getPdfPageCount(notAPdf);
      expect.unreachable("expected getPdfPageCount to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnreadablePdfError);
      expect((err as Error).message).toBe("We couldn't read this PDF. Please try a different file.");
    }
  });
});
