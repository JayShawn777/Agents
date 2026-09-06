import "server-only";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { getStoragePort } from "@/lib/storage/get-storage";
import { deleteCustomVoice } from "@/lib/voice/delete";

/**
 * Endpoint 52 — `DELETE /api/voice/[personaId]` (M6 AC 12/19).
 *
 * **404 for another account's persona, not 403** — the contract's default and
 * M1 AC 33's rule: the id is in the URL, so a refusal that distinguished
 * "exists but not yours" from "does not exist" would confirm the existence of
 * another family's voice to anyone pasting cuids.
 *
 * **A vendor failure still returns 200.** The local deletion completed, the
 * voice is gone from every surface a parent or child can reach, and a
 * `VENDOR_DELETE_FAILED` audit row exists for an operator to finish by hand.
 * Returning 5xx would tell the parent nothing happened when most of it did, and
 * invite a retry that finds nothing left to delete.
 */
export const DELETE = withAuth({
  handler: async ({ session, params }) => {
    const userId = session!.userId;
    const personaId = params?.personaId;
    if (typeof personaId !== "string") return errorResponse(apiErr("NOT_FOUND"));

    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return errorResponse(apiErr("NOT_FOUND"));

    const result = await deleteCustomVoice(getStoragePort(), {
      userId,
      userEmail: user.email,
      personaId,
    });
    if (!result.ok) return errorResponse(apiErr("NOT_FOUND"));

    return successResponse({ deleted: true });
  },
});
