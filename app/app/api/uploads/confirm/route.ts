import "server-only";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireStudentProfile } from "@/lib/auth/dal";
import { confirmUploadInputSchema } from "@/lib/schemas/upload";
import { recordUpload } from "@/lib/uploads/record-upload";
import { buildUploadPathnamePattern } from "@/lib/uploads/pathname";
import { toUploadDTO } from "@/lib/uploads/dto";
import { getStoragePort } from "@/lib/storage/get-storage";
import { PDF_PAGE_LIMIT } from "@/lib/config";

/**
 * ADR-0005: extraction is scheduled with `after()` inside `recordUpload` in
 * the SAME invocation as this response — `maxDuration` bounds how long
 * Vercel keeps the function alive to let that scheduled work finish.
 */
export const maxDuration = 300;

/**
 * Endpoint 15 (plan §3.2) — `POST /api/uploads/confirm`, the PRIMARY
 * persistence path (ADR-0003 step 5; the provider's `onUploadCompleted`
 * callback at `app/api/blob/upload/route.ts` is a backstop only, and never
 * fires on `localhost`, M1 AC 14).
 *
 * `studentProfileId` is BODY-derived, not a path param, so `withAuth()`'s
 * usual "resource resolves from `params` before the body is parsed"
 * ordering (steps 3-4 before step 6, ADR-0006) cannot apply here — there is
 * no resource to resolve until the body exists. `lib/api/handler.ts`'s own
 * docstring names exactly this shape of route ("the moment a route resolves
 * its subject from the request body rather than a path param") as the case
 * its ordering guard anticipates but does not itself solve. Ownership and
 * the ACTIVE gate are therefore checked manually, inside the handler,
 * immediately after the body parses — the earliest point they COULD run.
 */
export const POST = withAuth({
  bodySchema: confirmUploadInputSchema,
  handler: async ({ body }) => {
    // Owner: cross-account and nonexistent are indistinguishable (404).
    const student = await requireStudentProfile(body.studentProfileId);
    if (!student) return errorResponse(apiErr("NOT_FOUND"));
    // Owner+ACTIVE.
    if (student.status !== "ACTIVE") return errorResponse(apiErr("FORBIDDEN"));

    // Defense in depth (ADR-0003): the pathname was already namespaced to
    // this profile when its token was minted; re-asserting it here means a
    // tampered pathname is a detectable mismatch, not a trusted identifier.
    if (!buildUploadPathnamePattern(student.id).test(body.pathname)) {
      return errorResponse(apiErr("VALIDATION_ERROR"));
    }

    const result = await recordUpload({
      studentProfileId: student.id,
      pathname: body.pathname,
      originalFilename: body.originalFilename,
      storage: getStoragePort(),
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND_IN_STORE") return errorResponse(apiErr("NOT_FOUND"));
      if (result.code === "DISALLOWED_CONTENT_TYPE") return errorResponse(apiErr("VALIDATION_ERROR"));
      // PDF_PAGE_LIMIT_EXCEEDED (M1 AC 10): states the limit, per the spec.
      return errorResponse(
        apiErr("CONFLICT", {
          message: `PDFs are limited to ${PDF_PAGE_LIMIT} pages. Please upload a shorter file.`,
        }),
      );
    }

    return successResponse(
      { upload: toUploadDTO(result.upload), extractionId: result.extractionId },
      { status: result.created ? 201 : 200 },
    );
  },
});
