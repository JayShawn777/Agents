/**
 * Client-side upload validation (plan §5.2, F14; M1 AC 1, 4, 6, 7, 10;
 * ADR-0004). Pure orchestration over `sniff.ts` and `pdf-page-count.ts` — no
 * React, no network beyond the file already sitting in the browser's
 * memory.
 *
 * Every check here is UX only and is re-enforced server-side: the storage
 * provider's `allowedContentTypes`/`maximumSizeInBytes` constraints
 * (M0 AC 37/38) and endpoint 15's own page-count re-check (M1 AC 10) are
 * the real boundary. A tampered client that skips this module entirely
 * gets refused there, not here.
 */

import { getPdfPageCount, UnreadablePdfError } from "@/lib/uploads/pdf-page-count";
import { sniffFileKind } from "@/lib/uploads/sniff";
import { MAX_UPLOAD_BYTES, PDF_PAGE_LIMIT, type AcceptedPickerType } from "@/lib/config";

export type ClientValidationErrorCode =
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "TOO_MANY_PAGES"
  | "UNREADABLE_FILE";

export type ClientValidationResult =
  | { ok: true; kind: AcceptedPickerType; needsHeicConversion: boolean; pageCount: number | null }
  | { ok: false; code: ClientValidationErrorCode; message: string };

const ACCEPTED_FORMAT_LABEL = "JPEG, PNG, WEBP, HEIC or PDF";

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Validates a picked/dropped/captured file BEFORE any bytes are transmitted
 * (M1 AC 6). Order matters:
 *
 * 1. Size, which needs no I/O at all (`file.size` is already known).
 * 2. The file's REAL type, sniffed from magic bytes — never from
 *    `file.name`/`file.type` (M1 AC 4).
 * 3. For a PDF, its page count against `PDF_PAGE_LIMIT` (M1 AC 10).
 */
export async function validateFileForUpload(file: File): Promise<ClientValidationResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "TOO_LARGE",
      message: `This file is ${formatMegabytes(file.size)}. The largest file we can accept is ${formatMegabytes(MAX_UPLOAD_BYTES)}.`,
    };
  }

  const kind = await sniffFileKind(file);
  if (kind === null) {
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      message: `We can't read this type of file. Please upload a ${ACCEPTED_FORMAT_LABEL} file.`,
    };
  }

  if (kind === "application/pdf") {
    let pageCount: number;
    try {
      pageCount = await getPdfPageCount(file);
    } catch (err) {
      if (err instanceof UnreadablePdfError) {
        return { ok: false, code: "UNREADABLE_FILE", message: err.message };
      }
      throw err;
    }
    if (pageCount > PDF_PAGE_LIMIT) {
      return {
        ok: false,
        code: "TOO_MANY_PAGES",
        message: `This PDF has ${pageCount} pages. We can only read PDFs with up to ${PDF_PAGE_LIMIT} pages.`,
      };
    }
    return { ok: true, kind, needsHeicConversion: false, pageCount };
  }

  return {
    ok: true,
    kind,
    needsHeicConversion: kind === "image/heic",
    pageCount: null,
  };
}
