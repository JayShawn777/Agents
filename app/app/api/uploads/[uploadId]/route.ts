import "server-only";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireUpload, type UploadWithExtraction } from "@/lib/auth/dal";
import { toExtractionDTO, toUploadDTO } from "@/lib/uploads/dto";
import { deleteUpload } from "@/lib/uploads/delete-upload";
import { getStoragePort } from "@/lib/storage/get-storage";

/**
 * Endpoints 16-17 (plan §3.2) — `GET`/`DELETE /api/uploads/[uploadId]`. Both
 * resolve through `requireUpload` (`lib/auth/dal.ts`) — the ONLY function
 * that may load an `Upload` by id — so a cross-account id and a nonexistent
 * one are indistinguishable (404, M1 AC 33).
 */

async function resolveOwnedUpload({
  params,
}: {
  params: Record<string, string>;
}): Promise<UploadWithExtraction | null> {
  const uploadId = params.uploadId;
  if (!uploadId) return null;
  return requireUpload(uploadId);
}

export const GET = withAuth({
  resolveResource: resolveOwnedUpload,
  handler: async ({ resource: upload }) => {
    return successResponse({
      upload: toUploadDTO(upload),
      extraction: upload.extraction
        ? toExtractionDTO(upload.extraction, upload.extraction._count.problems)
        : null,
    });
  },
});

export const DELETE = withAuth({
  resolveResource: resolveOwnedUpload,
  handler: async ({ resource: upload }) => {
    // M1 AC 34: blobs before rows (ADR-0007 §1's discipline, applied to a
    // single upload — see `lib/uploads/delete-upload.ts`'s own docstring for
    // why this isn't `deleteStudentData` itself).
    const result = await deleteUpload(upload, getStoragePort());
    if (!result.ok) {
      // Row retained (marked SOURCE_DELETED), nothing else destroyed —
      // retryable (ADR-0007 §1).
      return errorResponse(apiErr("UPSTREAM_ERROR"));
    }
    return successResponse({ deleted: true as const });
  },
});
