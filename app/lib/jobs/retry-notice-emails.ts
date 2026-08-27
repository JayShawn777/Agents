import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import type { Clock } from "@/lib/jobs/clock";
import { sendDirectNoticeEmail } from "@/lib/email/send-direct-notice";
import { renderNoticeHtml, renderNoticeText } from "@/lib/notice/service";

/**
 * `GET /api/cron/retry-notice-emails` (endpoint 28, M0 AC 14) — retries
 * dispatch for every `DirectNotice` row whose `sentAt` is still `NULL`.
 * `@@index([sentAt])` on `DirectNotice` (`prisma/schema.prisma`) exists
 * specifically for this job's query.
 *
 * A `DirectNotice` row is written the instant the notice screen is shown
 * (`lib/notice/service.ts`'s `submitNotice`), with `sentAt: null` if the
 * mail provider rejected the message on the first attempt. This job is the
 * only thing that ever gets that row to `sentAt` afterward — nothing about
 * the notice SCREEN depends on the email succeeding (the profile advances
 * on submitting consent, not on notice delivery), but AC 14 requires the
 * SAME content to actually reach the parent by email, not just be shown in
 * a browser tab that may never be reopened.
 *
 * Takes `storage: StoragePort` for signature consistency with every other
 * job in `lib/jobs/*.ts` (plan B22: "Every one of these takes a StoragePort
 * and a clock as parameters") even though this job never touches storage —
 * a notice email has no attachment and no blob. Kept as a real parameter
 * rather than dropped, so the five job signatures stay uniform for the
 * cron-route wiring under `app/api/cron/` (one `route.ts` per job) and so a future notice
 * type that DID need storage wouldn't need a signature change to add it.
 */

export type RetryNoticeEmailsResult = {
  retried: number;
  sent: number;
};

export async function retryNoticeEmails(storage: StoragePort, clock: Clock): Promise<RetryNoticeEmailsResult> {
  const now = clock();

  const notices = await db.directNotice.findMany({
    where: { sentAt: null },
    include: { user: { select: { email: true } } },
  });

  let sent = 0;
  const html = renderNoticeHtml();
  const text = renderNoticeText();

  for (const notice of notices) {
    const result = await sendDirectNoticeEmail({
      to: notice.user.email,
      noticeVersion: notice.noticeVersion,
      html,
      text,
    });

    // Same rule as the first-attempt path (`lib/notice/service.ts`): only a
    // transport that actually accepted the message may stamp `sentAt`.
    if (result.delivered) {
      await db.directNotice.update({
        where: { id: notice.id },
        data: { sentAt: now, emailDeliveryRef: result.deliveryRef },
      });
      sent += 1;
    }
  }

  return { retried: notices.length, sent };
}
