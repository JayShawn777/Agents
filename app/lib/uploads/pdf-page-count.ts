/**
 * Client-side PDF page counting (plan §5.2, F14; M1 AC 10; ADR-0004).
 *
 * `pdf-lib` is imported ONLY inside `getPdfPageCount`, mirroring
 * `convert-heic.ts`'s lazy-load shape — a JPEG/PNG/WebP/HEIC upload never
 * causes this chunk to be requested either, for the same reason AC 5 rules
 * out a static import of the HEIC decoder.
 *
 * This is a UX check only: `POST /api/uploads/confirm` (endpoint 15,
 * backend track) re-counts pages server-side against the same
 * `PDF_PAGE_LIMIT` and is the actual enforcement point. A tampered or
 * bypassed client can only get a worse experience here, never a wider
 * limit than the server allows.
 */

/** User-safe message for a file that doesn't parse as a PDF at all. */
export class UnreadablePdfError extends Error {
  constructor() {
    super("We couldn't read this PDF. Please try a different file.");
    this.name = "UnreadablePdfError";
  }
}

/**
 * Resolves the page count of a PDF `File`. Throws `UnreadablePdfError` for
 * anything that fails to parse as a PDF (corrupt file, wrong magic bytes
 * slipping past `sniffFileKind`, etc.) — never a raw exception message.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = await file.arrayBuffer();
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    throw new UnreadablePdfError();
  }
}
