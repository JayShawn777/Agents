import "server-only";

import { db } from "@/lib/db";
import type { Upload } from "@/lib/generated/prisma/client";
import type { StoragePort } from "@/lib/storage/port";

export type DeleteUploadResult = { ok: true } | { ok: false; code: "STORAGE_FAILURE" };

/**
 * `DELETE /api/uploads/[uploadId]` (endpoint 17, M1 AC 34) — a SINGLE
 * upload, not a whole student profile. `deleteStudentData`
 * (`lib/deletion/service.ts`, B13) is "the one function that destroys a
 * student's data" (ADR-0007 §4) for its three whole-profile callers
 * (profile deletion, the §312.6 request, account closure); this is a
 * narrower, sibling operation with the SAME two-phase ordering discipline,
 * for the same reason ADR-0007 §1 states it once:
 *
 *   1. Mark `SOURCE_DELETED` and commit FIRST, so a reader mid-deletion sees
 *      an honest "source file removed" rather than a live upload whose
 *      bytes are already gone.
 *   2. `storage.del()` the blob.
 *   3. Only once (2) has succeeded: hard-delete the `Upload` row, which
 *      cascades `Extraction` and every `ExtractedProblem` (M1 AC 34).
 *
 * If step 2 fails, this returns `STORAGE_FAILURE` without touching step 3 —
 * the row stays `SOURCE_DELETED`, and calling this again re-attempts
 * `storage.del()` against the same pathname (idempotent by `StoragePort`
 * contract, matching `deleteStudentData`'s own retry story).
 */
export async function deleteUpload(upload: Upload, storage: StoragePort): Promise<DeleteUploadResult> {
  if (upload.status !== "SOURCE_DELETED") {
    await db.upload.update({
      where: { id: upload.id },
      data: { status: "SOURCE_DELETED", sourceDeletedAt: new Date() },
    });
  }

  try {
    await storage.del([upload.pathname]);
  } catch (err) {
    console.error(
      `deleteUpload: storage.del failed for upload ${upload.id}; row retained as SOURCE_DELETED for retry.`,
      err,
    );
    return { ok: false, code: "STORAGE_FAILURE" };
  }

  await db.upload.delete({ where: { id: upload.id } });
  return { ok: true };
}
