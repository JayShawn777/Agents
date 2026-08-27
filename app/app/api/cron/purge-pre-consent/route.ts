import { withCronJob } from "@/lib/api/cron";
import { getStoragePort } from "@/lib/storage/get-storage";
import { systemClock } from "@/lib/jobs/clock";
import { purgePreConsent } from "@/lib/jobs/purge-pre-consent";

/**
 * Endpoint 25 (plan §3.2) — `GET /api/cron/purge-pre-consent`.
 * ADR-0007 §5, M0 AC 22/23. See `lib/jobs/purge-pre-consent.ts` for the job.
 */
export const GET = withCronJob(() => purgePreConsent(getStoragePort(), systemClock));
