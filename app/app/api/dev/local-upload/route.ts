import "server-only";

import { z } from "zod";

import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { verifySession, requireStudentProfile } from "@/lib/auth/dal";
import { buildUploadPathnamePattern } from "@/lib/uploads/pathname";
import { ALLOWED_UPLOAD_CONTENT_TYPES, MAX_UPLOAD_BYTES, STORAGE_DRIVER, type UploadContentType } from "@/lib/config";
import { LocalFsStorage } from "@/lib/storage/local-fs";

/**
 * LOCAL DEV ONLY. `STORAGE_DRIVER=local` (the project default) has no CDN
 * for the client-direct upload protocol to hand bytes to — see ADR-0003 and
 * `lib/storage/local-fs.ts`'s own class docstring: the real
 * `handleClientUpload` protocol's two request bodies never carry file bytes
 * even in production, so no honest `StoragePort` implementation can move
 * bytes through that method alone.
 *
 * This route is the admission of that gap, kept STRICTLY separate from the
 * production path (`app/api/blob/upload/route.ts`) rather than folded into
 * it: it accepts raw bytes directly, something the production `vercel-blob`
 * path deliberately never does (ADR-0003 / M1 AC 2 — file bytes must travel
 * browser-to-CDN, never through our functions). It is fenced off with a
 * check that must run FIRST and refuses everything else if
 * `STORAGE_DRIVER !== "local"`, returning 404 rather than 403 — the same
 * shape as a route that does not exist, so a probe against a production
 * deployment (where `STORAGE_DRIVER=vercel-blob`) cannot even confirm this
 * path is present. There is no other guard in front of it; this check IS
 * the fence, and it is unconditional and unbypassable by any request input.
 *
 * Expected local-dev client flow — mirrors ADR-0003's three-step production
 * protocol, with this route standing in for the CDN hop:
 *
 *   1. `POST /api/blob/upload` (`blob.generate-client-token`) — the SAME
 *      route production uses. This is what enforces the hourly cap
 *      (M1 AC 17), ownership, and the ACTIVE-status gate, and it returns the
 *      pathname the client must use.
 *   2. `POST /api/dev/local-upload` (THIS route), with that exact pathname —
 *      writes the bytes nowhere else in local dev can.
 *   3. `POST /api/uploads/confirm` (endpoint 15, B17) — unchanged; it calls
 *      `storage.head()` against whichever driver is configured and never
 *      knows which path produced the bytes.
 *
 * Step 1's hourly cap is NOT re-checked here — it was already consumed when
 * the client obtained its token there, and re-checking it here would
 * double-count a single upload attempt.
 */
const fieldsSchema = z.object({
  studentProfileId: z.cuid(),
  pathname: z.string().min(1).max(512),
});

export async function POST(req: Request): Promise<Response> {
  // THE FENCE. Must run before anything else, unconditionally.
  if (STORAGE_DRIVER !== "local") {
    return errorResponse(apiErr("NOT_FOUND"));
  }

  const session = await verifySession();
  if (!session) return errorResponse(apiErr("UNAUTHENTICATED"));

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  const parsedFields = fieldsSchema.safeParse({
    studentProfileId: form.get("studentProfileId"),
    pathname: form.get("pathname"),
  });
  if (!parsedFields.success) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  const { studentProfileId, pathname } = parsedFields.data;

  // Ownership + ACTIVE gate, same as the production token-mint checks
  // (`app/api/blob/upload/route.ts`) — `studentProfileId` and `pathname` are
  // both attacker-controlled inputs to THIS endpoint too, independent of
  // whatever token request preceded it.
  const student = await requireStudentProfile(studentProfileId);
  if (!student) return errorResponse(apiErr("FORBIDDEN"));
  if (student.status !== "ACTIVE") return errorResponse(apiErr("FORBIDDEN"));

  if (!buildUploadPathnamePattern(studentProfileId).test(pathname)) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  const contentType = file.type;
  if (!ALLOWED_UPLOAD_CONTENT_TYPES.includes(contentType as UploadContentType)) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  const bytes = await file.arrayBuffer();
  const stored = await new LocalFsStorage().put(pathname, bytes, contentType);

  return successResponse({
    pathname: stored.pathname,
    contentType: stored.contentType,
    sizeBytes: stored.sizeBytes,
  });
}
