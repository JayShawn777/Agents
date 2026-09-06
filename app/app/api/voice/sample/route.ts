import "server-only";

import { z } from "zod";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { issueSampleGrant } from "@/lib/voice/sample";
import { ALLOWED_VOICE_CONTENT_TYPES } from "@/lib/config";

/**
 * Endpoint 50 — `POST /api/voice/sample`. Issues a single-use grant to upload
 * the voice SAMPLE (M6 AC 9/11).
 *
 * **No `studentProfileId`, in any form** — AC 3 satisfied structurally, exactly
 * as endpoint 48 does it. `.strict()` makes naming one a 400 rather than a
 * silently-ignored field.
 *
 * **The response carries no upload URL, and that is a correction to the plan.**
 * The plan's §3 table says `201 { uploadUrl, pathname, grantId }` and also says
 * the transport is "M1's flow, reused exactly". Those contradict each other:
 * M1 mints no upload URLs. It uses the provider's client-token protocol, where
 * the browser calls `upload()` against `POST /api/blob/upload` and that route
 * authorizes the request. `StoragePort` has no write-URL method and gains none
 * here — adding one would mean a second upload path to keep secure, for a flow
 * that runs a handful of times per account. The plan's intent ("no request to
 * our origin ever carries audio bytes") holds either way. So the browser is
 * handed `{ grantId, pathname }` and passes the grant back through
 * `clientPayload`; `authorizeVoiceUpload` asserts the pathname against it.
 *
 * AC 1's adult gate is checked here rather than in `withAuth`, for the reason
 * endpoint 48 gives: `adultAttestedAt` lives on `User` and the session carries
 * only a `userId`.
 */
const bodySchema = z
  .object({
    contentType: z.enum(ALLOWED_VOICE_CONTENT_TYPES),
    /** The container extension, so the stored object is named honestly. */
    extension: z.enum(["webm", "ogg", "m4a", "mp3", "wav", "aac", "flac"]),
    /** AC 9. Measured by the recorder; re-checked server-side against the bounds. */
    durationMs: z.number().int().positive(),
    /** AC 6. Re-verified server-side — this arrives from the client. */
    consentRecordingId: z.cuid(),
  })
  .strict();

export const POST = withAuth({
  bodySchema,
  handler: async ({ session, body }) => {
    const userId = session!.userId;

    // AC 1. Tested POSITIVELY (must be set), so a future column change cannot
    // silently start admitting people.
    const user = await db.user.findUnique({ where: { id: userId }, select: { adultAttestedAt: true } });
    if (!user?.adultAttestedAt) {
      return errorResponse(apiErr("FORBIDDEN", { message: "This requires a verified adult account holder." }));
    }

    const result = await issueSampleGrant({
      userId,
      contentType: body.contentType,
      extension: body.extension,
      durationMs: body.durationMs,
      consentRecordingId: body.consentRecordingId,
    });

    if (!result.ok) {
      switch (result.code) {
        case "RATE_LIMITED":
          return errorResponse(apiErr("RATE_LIMITED"));
        case "DURATION_OUT_OF_BOUNDS":
          return errorResponse(
            apiErr("VALIDATION_ERROR", { message: "That recording is too short or too long." }),
          );
        case "NO_USABLE_CONSENT":
          // AC 6. 409 rather than 403: the request is well-formed and the caller
          // is permitted — the account is simply not in a state where a sample
          // may be taken, because no current consent statement has been recorded.
          return errorResponse(
            apiErr("CONFLICT", { message: "Record the consent statement before recording a voice sample." }),
          );
        default:
          return errorResponse(apiErr("VALIDATION_ERROR", { message: "That audio format isn't supported." }));
      }
    }

    return successResponse(
      { grantId: result.grantId, pathname: result.pathname, consentRecordingId: result.consentRecordingId },
      { status: 201 },
    );
  },
});
