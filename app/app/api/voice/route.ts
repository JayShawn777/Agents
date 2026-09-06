import "server-only";

import { z } from "zod";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { getStoragePort } from "@/lib/storage/get-storage";
import { createCustomVoice } from "@/lib/voice/create";

/**
 * Endpoint 51 — `POST /api/voice`. Creates the cloned voice (M6 AC 13/14/15/21).
 *
 * **Synchronous, not `after()`-scheduled** (plan §3). The measurement timed
 * creation at ~2s; M4/M5's `after()` pattern exists for 12-59s work, and using
 * it here would add a polling UI and a status machine to buy nothing. If a
 * future measurement shows creation is slow or asynchronous, this is the first
 * decision to revisit.
 *
 * **No `studentProfileId`** — AC 3, structural, as with endpoints 48 and 50.
 *
 * **AC 14: nothing from the vendor reaches the browser.** Every failure below
 * maps to one of our own messages. The provider's status codes and response
 * bodies stay inside `lib/voice/provider.ts` and the server log.
 */
const bodySchema = z
  .object({
    sampleGrantId: z.cuid(),
    /**
     * What the parent calls this voice, shown to their own children. Never sent
     * to the vendor — see `lib/voice/naming.ts`.
     */
    label: z.string().trim().min(1).max(40),
  })
  .strict();

export const POST = withAuth({
  bodySchema,
  handler: async ({ session, body }) => {
    const userId = session!.userId;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { adultAttestedAt: true, email: true },
    });
    if (!user?.adultAttestedAt) {
      return errorResponse(apiErr("FORBIDDEN", { message: "This requires a verified adult account holder." }));
    }

    const result = await createCustomVoice(getStoragePort(), {
      userId,
      userEmail: user.email,
      sampleGrantId: body.sampleGrantId,
      label: body.label,
    });

    if (!result.ok) {
      switch (result.code) {
        case "CAP_REACHED":
          return errorResponse(
            apiErr("CONFLICT", { message: "You've already created the maximum number of voices." }),
          );
        case "RATE_LIMITED":
          return errorResponse(apiErr("RATE_LIMITED"));
        case "NO_USABLE_CONSENT":
          return errorResponse(
            apiErr("CONFLICT", { message: "Record the consent statement before creating a voice." }),
          );
        case "VENDOR_FAILED":
          return errorResponse(
            apiErr("UPSTREAM_ERROR", {
              message: result.retryable
                ? "We couldn't create the voice just now. Please try again."
                : "We couldn't create the voice. Please record a new sample and try again.",
            }),
          );
        default:
          // GRANT_UNUSABLE and SAMPLE_MISSING. Both mean "start the recording
          // again", and distinguishing them for the caller would leak whether a
          // grant id exists.
          return errorResponse(
            apiErr("CONFLICT", { message: "That recording is no longer available. Please record again." }),
          );
      }
    }

    return successResponse(
      { persona: { id: result.personaId, status: result.status } },
      { status: 202 },
    );
  },
});
