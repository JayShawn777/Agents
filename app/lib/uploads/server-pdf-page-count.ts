import "server-only";

import { PDFDocument } from "pdf-lib";

/**
 * SERVER-SIDE PDF page count (M1 AC 10), called from
 * `lib/uploads/record-upload.ts` against the bytes actually in storage —
 * this is the count that is ever TRUSTED to reject an upload.
 *
 * Named distinctly from `lib/uploads/pdf-page-count.ts` (frontend track,
 * plan F14) rather than sharing that path: that file is a client-side, UX-only
 * helper with no `server-only` guard, dynamically imported so a non-PDF
 * upload never pulls `pdf-lib`'s chunk into the browser bundle. The two
 * helpers solve deliberately different problems (client UX vs. server
 * enforcement) and neither should import the other — see this task's report
 * for the plan ambiguity this collision came from (both tracks' file lists
 * named the same path).
 *
 * `ignoreEncryption: true` / `updateMetadata: false`: this only ever needs a
 * page count, never a mutation, and a password-protected-but-openable PDF
 * should still be counted rather than rejected outright by pdf-lib's default
 * strictness.
 */
export async function countPdfPagesServerSide(bytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}
