import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { confirmConsentRecording } from "@/lib/voice/consent";
import { getStoragePort } from "@/lib/storage/get-storage";

/**
 * Endpoint 49 — `POST /api/voice/consent-recording/[grantId]/confirm`.
 *
 * The upload has landed; this turns it into the durable record (AC 7).
 *
 * **`ipAddress` and `userAgent` are read SERVER-side from headers and never
 * accepted from the body** — the same rule `ParentalConsent` follows
 * (ADR-0007 §3). A client-supplied IP on a consent artifact is worse than no IP:
 * it looks like evidence and is not.
 *
 * `durationMs` IS client-supplied, and that is a deliberate, bounded trust.
 * Reading a real duration server-side would mean decoding the audio container,
 * which needs a media dependency this app does not have and the constitution
 * would require approval for. It is bounds-checked at the boundary, and the
 * value is descriptive rather than load-bearing: nothing is authorised because
 * of it, and the object's real existence is verified separately with
 * `storage.head()`. If a future need makes the duration load-bearing, decode it
 * then rather than trusting this harder.
 */
export const POST = withAuth({
  bodySchema: z
    .object({
      /** Bounds are re-checked in `confirmConsentRecording`; this is the shape gate. */
      durationMs: z.number().int().positive().max(10 * 60 * 1000),
    })
    .strict(),
  handler: async ({ session, params, body }) => {
    const grantId = params.grantId;
    if (!grantId) return errorResponse(apiErr("NOT_FOUND"));

    const headerList = await headers();
    const ipAddress = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = headerList.get("user-agent");

    const result = await confirmConsentRecording(getStoragePort(), {
      userId: session!.userId,
      grantId,
      durationMs: body.durationMs,
      ipAddress,
      userAgent,
    });

    if (result.ok) {
      return successResponse({ consentRecordingId: result.consentRecordingId }, { status: 201 });
    }

    switch (result.code) {
      case "NOT_FOUND":
        return errorResponse(apiErr("NOT_FOUND"));
      case "ALREADY_USED":
        return errorResponse(apiErr("CONFLICT", { message: "That recording was already saved." }));
      case "NO_OBJECT":
        return errorResponse(apiErr("CONFLICT", { message: "We didn't receive the recording. Please try again." }));
      case "DURATION_OUT_OF_BOUNDS":
        return errorResponse(
          apiErr("VALIDATION_ERROR", { message: "That recording was too short or too long. Please try again." }),
        );
    }
  },
});
