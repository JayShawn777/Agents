import { withCronJob } from "@/lib/api/cron";
import { getStoragePort } from "@/lib/storage/get-storage";
import { systemClock } from "@/lib/jobs/clock";
import { retryNoticeEmails } from "@/lib/jobs/retry-notice-emails";

/**
 * Endpoint 28 (plan §3.2) — `GET /api/cron/retry-notice-emails`.
 * M0 AC 14. See `lib/jobs/retry-notice-emails.ts` for the job.
 */
export const GET = withCronJob(() => retryNoticeEmails(getStoragePort(), systemClock));
