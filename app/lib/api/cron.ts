import "server-only";

import { apiErr, errorResponse, successResponse } from "@/lib/errors";

/**
 * `withCronJob()` — the single wrapper behind all five `GET /api/cron/*`
 * routes (B23, plan §3.2 endpoints 24-28).
 *
 * Auth, per plan §3: **Cron** = `Authorization: Bearer ${CRON_SECRET}`, 401
 * otherwise. This is the ONLY place that header is checked — no session,
 * no same-origin check (`withAuth()`'s checks are for the browser-facing
 * surface; these routes are never called by a browser). `CRON_SECRET` is
 * read from `process.env` on every request, not at module load, so a route
 * file can be imported in a test before the secret is stubbed, and so an
 * operator who sets the var after the process has booted doesn't need a
 * redeploy. An unset secret is treated as "no valid secret" (fail closed),
 * never as "auth disabled".
 *
 * Every job (`lib/jobs/*.ts`) is a pure function of `(StoragePort, Clock)`
 * that either resolves with its typed summary or rejects. Per the plan's
 * fixed error shape for these five endpoints (401 · 502 — no 500 in the
 * documented contract), any rejection — a thrown `StoragePort` error, a
 * database error — is mapped to `502 UPSTREAM_ERROR` here, not to the
 * generic `INTERNAL_ERROR` a browser-facing route falls back to. A storage
 * failure is reported and left for the NEXT scheduled run to retry; nothing
 * here retries automatically or swallows the error.
 */
export function withCronJob<T>(runJob: () => Promise<T>) {
  return async (req: Request): Promise<Response> => {
    const expectedSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return errorResponse(apiErr("UNAUTHENTICATED"));
    }

    try {
      const data = await runJob();
      return successResponse(data);
    } catch (err) {
      console.error("Cron job failed", err);
      return errorResponse(apiErr("UPSTREAM_ERROR"));
    }
  };
}
