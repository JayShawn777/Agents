import "server-only";

/**
 * The client-proposed and server-verified upload pathname shape (ADR-0003):
 * `students/<studentProfileId>/uploads/<random>.<ext>`. Namespacing by
 * profile id is what turns a cross-account pathname into a DETECTABLE
 * mismatch rather than a trusted identifier (ADR-0003, "Pathnames, not
 * URLs"): every place a pathname is accepted from the client re-asserts it
 * against the SAME pattern, built here once so the call sites
 * (`app/api/blob/upload/route.ts` at token-mint time, the local-dev ingest
 * route, and `lib/uploads/record-upload.ts` at confirm time) can never drift
 * from each other.
 *
 * Matches plan §3 endpoint 14 exactly:
 * `^students/<authorizedId>/uploads/[A-Za-z0-9-]+\.[a-z0-9]+$`.
 */
export function buildUploadPathnamePattern(studentProfileId: string): RegExp {
  return new RegExp(`^students/${escapeRegExp(studentProfileId)}/uploads/[A-Za-z0-9-]+\\.[a-z0-9]+$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
