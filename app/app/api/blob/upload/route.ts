import "server-only";

import { z } from "zod";

import { apiErr, errorResponse } from "@/lib/errors";
import { isSameOriginRequest } from "@/lib/api/handler";
import { verifySession, requireStudentProfile } from "@/lib/auth/dal";
import { uploadClientPayloadSchema } from "@/lib/schemas/upload";
import { buildUploadPathnamePattern } from "@/lib/uploads/pathname";
import { recordUploadTokenGrant } from "@/lib/uploads/rate-limit";
import { getStoragePort } from "@/lib/storage/get-storage";
import { ALLOWED_UPLOAD_CONTENT_TYPES, MAX_UPLOAD_BYTES } from "@/lib/config";
import type { ClientUploadPolicy } from "@/lib/storage/port";

/**
 * Endpoint 14 (plan §3.2) — `POST /api/blob/upload`, ADR-0003 step 3.
 *
 * This route does NOT go through `withAuth()`. Every other route in this
 * codebase has one caller shape (a signed-in browser); this one has two, on
 * the SAME URL, discriminated by `body.type`:
 *
 *   - `blob.generate-client-token` — a signed-in browser about to start an
 *     upload. Session (401), ownership of the claimed `studentProfileId`
 *     (403 — NOT 404: M1 AC 12 calls for a refusal here, unlike the
 *     "cross-account is always 404" default elsewhere in the contract,
 *     because the "resource" is named inside an attacker-controlled body
 *     field rather than the URL), the ACTIVE-status gate tested POSITIVELY
 *     (403 — ADR-0003's revision note: a fourth status added later must not
 *     silently start issuing tokens), the pathname assertion, and the
 *     hourly cap (429) all run BEFORE this route ever delegates to storage.
 *   - `blob.upload-completed` — the storage provider's own signed callback
 *     (ADR-0003 step 6), which never carries a browser session at all. Our
 *     job is only to hand it to `storage.handleClientUpload()` unchanged;
 *     `withAuth()`'s `mode: "session"` would 401 every one of these calls in
 *     production, which is why this route is hand-rolled rather than routed
 *     through it.
 *
 * The success response is NOT an `ApiResult<T>` — plan §3 endpoint 14 is
 * explicit that a 200 here carries "the provider's token JSON" verbatim, so
 * the browser's `upload()` call (which speaks the provider's own wire
 * protocol, not ours) can consume it directly. Every error path this route
 * decides on its own IS the shared `ApiResult` shape.
 */

const uploadEventEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("blob.generate-client-token"),
    payload: z.object({
      pathname: z.string().min(1).max(512),
      // The client's opaque, JSON-stringified `clientPayload` — OUR external
      // input, validated below with `uploadClientPayloadSchema` once parsed.
      clientPayload: z.string().nullable().optional(),
      multipart: z.boolean().optional(),
      callbackUrl: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("blob.upload-completed"),
    payload: z.object({
      blob: z.object({
        pathname: z.string(),
        contentType: z.string().optional(),
      }),
      tokenPayload: z.string().nullable().optional(),
    }),
  }),
]);

export async function POST(req: Request): Promise<Response> {
  // ADR-0006's same-origin CSRF mitigation applies to this route too, even
  // though it isn't built on `withAuth()`. A provider callback carries
  // neither `Origin` nor `Sec-Fetch-Site`, which `isSameOriginRequest`
  // already treats as same-origin (defense in depth on top of session
  // cookies, not the sole control) — so this never blocks the legitimate
  // `blob.upload-completed` caller.
  if (!isSameOriginRequest(req)) {
    return errorResponse(apiErr("FORBIDDEN"));
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  const parsedEnvelope = uploadEventEnvelopeSchema.safeParse(rawBody);
  if (!parsedEnvelope.success) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  const envelope = parsedEnvelope.data;

  const policy: ClientUploadPolicy = {
    access: "private",
    allowedContentTypes: [...ALLOWED_UPLOAD_CONTENT_TYPES],
    maximumSizeInBytes: MAX_UPLOAD_BYTES,
    addRandomSuffix: true,
  };

  if (envelope.type === "blob.upload-completed") {
    // Provider callback (ADR-0003 step 6) — a BACKSTOP, not the primary
    // persistence path (that is `POST /api/uploads/confirm`, B17). No
    // session exists here and none is required: the pathname was already
    // authorized when the client token for it was minted, and
    // `recordUpload()`'s idempotent upsert on `pathname` is what makes a
    // second, redundant call from this path harmless (M1 AC 15).
    return getStoragePort().handleClientUpload(req, envelope, policy);
  }

  // `blob.generate-client-token` — our own checks run BEFORE delegating
  // (ADR-0003 step 3).
  const session = await verifySession();
  if (!session) return errorResponse(apiErr("UNAUTHENTICATED"));

  if (!envelope.payload.clientPayload) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  let rawClientPayload: unknown;
  try {
    rawClientPayload = JSON.parse(envelope.payload.clientPayload);
  } catch {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  const parsedClientPayload = uploadClientPayloadSchema.safeParse(rawClientPayload);
  if (!parsedClientPayload.success) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  const { studentProfileId } = parsedClientPayload.data;

  // Ownership: `requireStudentProfile` is scoped by `session.userId` — a
  // cross-account id and a nonexistent one are indistinguishable. Both are
  // 403 HERE (not the usual 404), because M1 AC 12 specifically calls for a
  // refusal rather than a not-found on this endpoint.
  const student = await requireStudentProfile(studentProfileId);
  if (!student) {
    return errorResponse(apiErr("FORBIDDEN"));
  }

  // M1 AC 11 / AC 36, ADR-0003's revision note: tested POSITIVELY against
  // `ACTIVE`. Do NOT invert this into a denylist of refused statuses — a
  // fourth `StudentProfileStatus` value added later would silently start
  // issuing upload tokens for it.
  if (student.status !== "ACTIVE") {
    return errorResponse(apiErr("FORBIDDEN"));
  }

  if (!buildUploadPathnamePattern(student.id).test(envelope.payload.pathname)) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  const allowed = await recordUploadTokenGrant(student.id, envelope.payload.pathname);
  if (!allowed) {
    return errorResponse(apiErr("RATE_LIMITED"));
  }

  return getStoragePort().handleClientUpload(req, envelope, policy);
}
