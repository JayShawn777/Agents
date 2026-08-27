import { withCronJob } from "@/lib/api/cron";
import { getStoragePort } from "@/lib/storage/get-storage";
import { systemClock } from "@/lib/jobs/clock";
import { purgeClosedAccounts } from "@/lib/jobs/purge-closed-accounts";

/**
 * Endpoint 26 (plan §3.2) — `GET /api/cron/purge-closed-accounts`.
 * ADR-0007 §4(c), M0 AC 47. See `lib/jobs/purge-closed-accounts.ts` for the
 * job — the third caller of `deleteStudentData`.
 */
export const GET = withCronJob(() => purgeClosedAccounts(getStoragePort(), systemClock));
