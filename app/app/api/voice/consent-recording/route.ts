import "server-only";

import { z } from "zod";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { issueConsentGrant } from "@/lib/voice/consent";
import { ACCEPTED_VOICE_CONTENT_TYPES } from "@/lib/voice/naming";
import { VOICE_CONSENT_LINES, VOICE_CONSENT_WORDING_VERSION } from "@/lib/voice/consent-copy";

/**
 * Endpoint 48 — `POST /api/voice/consent-recording`. Issues a single-use grant
 * to upload the spoken consent statement (M6 AC 5/7).
 *
 * **There is no `studentProfileId` here, in any form — that is AC 3, satisfied
 * structurally.** AC 3 requires a request naming a student profile as the
 * speaker to be refused; the strongest way to refuse it is to have nowhere to
 * put it. `.strict()` on the body means naming one is a 400 rather than a
 * silently-ignored field.
 *
 * **The pathname is not in the request or the response contract by accident.**
 * The client is told where to upload; it never proposes where. See
 * `lib/voice/consent.ts` for why that is what makes AC 4 enforceable.
 *
 * AC 1's adult gate is checked here rather than in `withAuth`: `adultAttestedAt`
 * lives on `User`, and `withAuth`'s session carries only a `userId`. Refused
 * with 403, matching the spec's own wording.
 */
const bodySchema = z
  .object({
    contentType: z.enum(ACCEPTED_VOICE_CONTENT_TYPES as [string, ...string[]]),
    /** The container extension, so the stored object is named honestly. */
    extension: z.enum(["webm", "ogg", "m4a", "mp3", "wav", "aac", "flac"]),
  })
  .strict();

export const POST = withAuth({
  bodySchema,
  handler: async ({ session, body }) => {
    const userId = session!.userId;

    // AC 1. An account that never attested to being an adult may not reach any
    // part of this flow — tested POSITIVELY (must be set), so a future column
    // change cannot silently start admitting people.
    const user = await db.user.findUnique({ where: { id: userId }, select: { adultAttestedAt: true } });
    if (!user?.adultAttestedAt) {
      return errorResponse(apiErr("FORBIDDEN", { message: "This requires a verified adult account holder." }));
    }

    const result = await issueConsentGrant({
      userId,
      contentType: body.contentType,
      extension: body.extension,
    });

    if (!result.ok) {
      if (result.code === "RATE_LIMITED") return errorResponse(apiErr("RATE_LIMITED"));
      return errorResponse(apiErr("VALIDATION_ERROR", { message: "That audio format isn't supported." }));
    }

    return successResponse(
      {
        grantId: result.grantId,
        pathname: result.pathname,
        // Returned so the recording screen renders exactly the words this grant
        // will be evidence of — the version is stamped on the row at confirm,
        // and the two must not be able to drift.
        wordingVersion: VOICE_CONSENT_WORDING_VERSION,
        lines: VOICE_CONSENT_LINES,
      },
      { status: 201 },
    );
  },
});
