import "server-only";

import { z } from "zod";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { revokeCustomVoice } from "@/lib/voice/delete";

/**
 * Endpoint 53 — `POST /api/voice/[personaId]/revoke` (M6 AC 18).
 *
 * Revocation, not deletion: the persona row survives as `REVOKED` so cached
 * narration keeps its attribution, while the voice becomes unselectable, every
 * profile that had chosen it falls back to the default, and the clone is removed
 * at the vendor — see `lib/voice/delete.ts` for why revocation reaches the
 * vendor even though AC 18 alone does not demand it.
 */
export const POST = withAuth({
  bodySchema: z.object({}).strict(),
  handler: async ({ session, params }) => {
    const userId = session!.userId;
    const personaId = params?.personaId;
    if (typeof personaId !== "string") return errorResponse(apiErr("NOT_FOUND"));

    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return errorResponse(apiErr("NOT_FOUND"));

    const result = await revokeCustomVoice({ userId, userEmail: user.email, personaId });
    if (!result.ok) return errorResponse(apiErr("NOT_FOUND"));

    return successResponse({ persona: { id: personaId, status: "REVOKED" } });
  },
});
