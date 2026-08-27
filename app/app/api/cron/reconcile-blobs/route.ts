import { withCronJob } from "@/lib/api/cron";
import { getStoragePort } from "@/lib/storage/get-storage";
import { systemClock } from "@/lib/jobs/clock";
import { reconcileBlobs } from "@/lib/jobs/reconcile-blobs";

/**
 * Endpoint 24 (plan §3.2) — `GET /api/cron/reconcile-blobs`.
 * ADR-0007 §2. See `lib/jobs/reconcile-blobs.ts` for the job itself.
 */
export const GET = withCronJob(() => reconcileBlobs(getStoragePort(), systemClock));
