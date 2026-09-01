import "server-only";

import { z } from "zod";

import { apiErr, errorResponse } from "@/lib/errors";
import { verifySession, requireStudentProfile } from "@/lib/auth/dal";
import { STORAGE_DRIVER } from "@/lib/config";
import { getStoragePort } from "@/lib/storage/get-storage";

/**
 * LOCAL DEV ONLY. `GET /api/dev/local-object?pathname=...` — M5 §6 (plan
 * "slice 9"). Modelled exactly on `app/api/dev/local-upload/route.ts`,
 * mirrored to the read side: `LocalFsStorage.signedReadUrl` returns a
 * deliberately non-fetchable `local-storage://…` placeholder (see that
 * class's own docstring) because there is no local CDN to mint a real one
 * against. Without this route, `STORAGE_DRIVER=local` (the project default)
 * can generate narration audio but a browser has no way to fetch its bytes —
 * nobody has yet heard a single word of it.
 *
 * **THE FENCE — must run first, unconditionally, before session or any other
 * check.** `if (STORAGE_DRIVER !== "local") return 404` — not 403 — so a
 * probe against a production deployment (where `STORAGE_DRIVER=vercel-blob`)
 * gets the exact same response a nonexistent route would, and cannot even
 * confirm this path exists. There is no other guard in front of it; this
 * check IS the fence.
 *
 * **Why this route still requires a session, even though it is dev-only.**
 * "Dev-only" is not "unauthenticated" — narration audio is generated from a
 * child's schoolwork, and reasoning "it only runs on a laptop" is exactly
 * the kind of scoping-out-loud that has been a real security incident at
 * other companies. Session plus ownership costs nothing here (`prisma dev`
 * already requires a signed-in user to have generated any narration to
 * fetch), and it keeps this route's authorization shape identical to every
 * other read path in the app rather than a special case that is easy to
 * forget hardening later if it ever migrated beyond dev.
 *
 * **Why this is not a blanket local-file-read endpoint.** `pathname` is
 * attacker-controlled input. It must match
 * `students/<studentProfileId>/narration/<cacheKey>.mp3` EXACTLY —
 * `NARRATION_PATHNAME_PATTERN` below has no `.`/`..` segment, no leading
 * `/`, and no path separator inside either captured segment, so there is no
 * shape a traversal or an absolute path could take that still matches. The
 * captured `studentProfileId` is then re-verified as a profile the CALLING
 * session owns (`requireStudentProfile`) — a syntactically valid pathname
 * naming someone else's profile is a 404, the same "cross-account and
 * nonexistent must be indistinguishable" rule M1 AC 33 uses. Only after both
 * checks pass does this touch `StoragePort`, which re-validates the
 * pathname a third time internally (`LocalFsStorage`'s own
 * `resolveSafePath`, defense in depth) before any filesystem call.
 *
 * Not built on `withAuth` (`lib/api/handler.ts`): that helper's contract
 * requires every handler to return a `successResponse`/`errorResponse` JSON
 * envelope, and this route's whole job on success is to return raw audio
 * bytes with an audio `Content-Type` — the same reason
 * `app/api/dev/local-upload/route.ts` doesn't use it either. Every FAILURE
 * path below still returns the shared typed `ApiError` envelope
 * (`lib/errors.ts`), so a caller checking for the app's one error shape
 * still gets it.
 */
const NARRATION_PATHNAME_PATTERN = /^students\/([A-Za-z0-9_-]+)\/narration\/([A-Za-z0-9_-]+)\.mp3$/;

const querySchema = z.object({
  pathname: z.string().min(1).max(512).regex(NARRATION_PATHNAME_PATTERN),
});

export async function GET(req: Request): Promise<Response> {
  // THE FENCE. Must run before anything else, unconditionally.
  if (STORAGE_DRIVER !== "local") {
    return errorResponse(apiErr("NOT_FOUND"));
  }

  const session = await verifySession();
  if (!session) return errorResponse(apiErr("UNAUTHENTICATED"));

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ pathname: url.searchParams.get("pathname") });
  if (!parsed.success) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }
  const { pathname } = parsed.data;

  // Re-derive the owning profile id from the ALREADY-VALIDATED pathname
  // (the regex above is what proved this match exists and is well-formed).
  const match = NARRATION_PATHNAME_PATTERN.exec(pathname);
  const studentProfileId = match?.[1];
  if (!studentProfileId) {
    return errorResponse(apiErr("VALIDATION_ERROR"));
  }

  // Ownership check: a syntactically valid pathname naming a profile this
  // session does not own is a 404, not a 403 (M1 AC 33's rule, applied here).
  const student = await requireStudentProfile(studentProfileId);
  if (!student) return errorResponse(apiErr("NOT_FOUND"));

  const storage = getStoragePort();

  let meta: { contentType: string; sizeBytes: number } | null;
  try {
    meta = await storage.head(pathname);
  } catch {
    return errorResponse(apiErr("NOT_FOUND"));
  }
  if (!meta) return errorResponse(apiErr("NOT_FOUND"));

  let bytes: ArrayBuffer;
  try {
    bytes = await storage.readBytes(pathname);
  } catch {
    return errorResponse(apiErr("NOT_FOUND"));
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(meta.sizeBytes),
      // Same reasoning as every other response in this app (`lib/errors.ts`
      // `jsonResponse`): none of this app's data is safe to cache, and
      // narration audio is derived from a child's schoolwork.
      "Cache-Control": "no-store",
    },
  });
}
