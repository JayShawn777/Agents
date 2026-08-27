import "server-only";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireUpload, type UploadWithExtraction } from "@/lib/auth/dal";
import { getStoragePort } from "@/lib/storage/get-storage";
import { SIGNED_URL_TTL_MS } from "@/lib/config";

async function resolveOwnedUpload({
  params,
}: {
  params: Record<string, string>;
}): Promise<UploadWithExtraction | null> {
  const uploadId = params.uploadId;
  if (!uploadId) return null;
  return requireUpload(uploadId);
}

/**
 * Endpoint 18 (plan §3.2, M1 AC 31/32) — `GET /api/uploads/[uploadId]/preview-url`.
 * The ONLY place a signed URL is ever minted (M1 AC 31). `Cache-Control:
 * no-store` is applied to every response body by `lib/errors.ts`'s shared
 * `jsonResponse` helper — nothing here needs to set it a second time.
 */
export const GET = withAuth({
  resolveResource: resolveOwnedUpload,
  handler: async ({ resource: upload }) => {
    if (upload.status === "SOURCE_DELETED") {
      return errorResponse(
        apiErr("CONFLICT", { message: "The original file for this upload has already been removed." }),
      );
    }

    const { url, expiresAt } = await getStoragePort().signedReadUrl(upload.pathname, SIGNED_URL_TTL_MS);
    return successResponse({ url, expiresAt: expiresAt.toISOString() });
  },
});
