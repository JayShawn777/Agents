import { withCronJob } from "@/lib/api/cron";
import { getStoragePort } from "@/lib/storage/get-storage";
import { systemClock } from "@/lib/jobs/clock";
import { enforceRetention } from "@/lib/jobs/enforce-retention";

/**
 * Endpoint 27 (plan §3.2) — `GET /api/cron/enforce-retention`.
 * ADR-0007 §5, M0 AC 45 / M1 AC 36. See `lib/jobs/enforce-retention.ts` for
 * the job, including the flagged `DIRECT_NOTICE` plan gap.
 */
export const GET = withCronJob(() => enforceRetention(getStoragePort(), systemClock));
