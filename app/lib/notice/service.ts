import "server-only";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { sendDirectNoticeEmail } from "@/lib/email/send-direct-notice";
import { DIRECT_NOTICE_COPY, DIRECT_NOTICE_VERSION } from "@/lib/notice/copy";
import type { DirectNotice, StudentProfile } from "@/lib/generated/prisma/client";

/**
 * Endpoint 7 (plan §3.2) — `POST /api/students/[studentId]/notice`. Writes a
 * `DirectNotice` row and dispatches the §312.4 notice email (AC 12-14). A
 * `ParentalConsent` row can never exist without one of these
 * (`ParentalConsent.directNoticeId`, `onDelete: Restrict`) — this is the hard
 * precondition AC 15 describes, enforced at the schema and flow level, not
 * just in copy.
 */

export type SubmitNoticeResult =
  | { ok: true; notice: DirectNotice }
  | {
      /**
       * AC 14: the client rendered a notice screen under a version that is
       * no longer the deployed one — the parent read stale copy. 409, per
       * plan §3 endpoint 7: re-render and retry with the current version.
       */
      ok: false;
      code: "STALE_VERSION";
    };

export async function submitNotice(args: {
  student: Pick<StudentProfile, "id">;
  user: { id: string; email: string };
  noticeVersion: string;
}): Promise<SubmitNoticeResult> {
  if (args.noticeVersion !== DIRECT_NOTICE_VERSION) {
    return { ok: false, code: "STALE_VERSION" };
  }

  // Read server-side from headers, never trusted from the body (the same
  // pattern used for `ParentalConsent.ipAddress`/`userAgent`, ADR-0007 §3).
  const headerList = await headers();
  const ipAddress = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerList.get("user-agent");

  // AC 12/14, plan §3 endpoint 7: "repeat calls append another notice row
  // and are not an error" — always a fresh `create`, never an upsert against
  // an existing row for this student.
  const notice = await db.directNotice.create({
    data: {
      studentProfileId: args.student.id,
      userId: args.user.id,
      noticeVersion: DIRECT_NOTICE_VERSION,
      ipAddress,
      userAgent,
    },
  });

  const emailResult = await sendDirectNoticeEmail({
    to: args.user.email,
    noticeVersion: DIRECT_NOTICE_VERSION,
    html: renderNoticeHtml(),
    text: renderNoticeText(),
  });

  // AC 14: `sentAt` is stamped ONLY when a real transport actually accepted
  // the message (`SendEmailResult.delivered`) — never off the console
  // transport's placeholder result (`lib/email/client.ts`'s own docstring:
  // "a caller must never stamp a compliance timestamp off this result").
  if (emailResult.delivered) {
    const updated = await db.directNotice.update({
      where: { id: notice.id },
      data: { sentAt: new Date(), emailDeliveryRef: emailResult.deliveryRef },
    });
    return { ok: true, notice: updated };
  }

  // The record is written either way — the notice screen was shown and the
  // record of that exists — with `sentAt: null`. The caller (the route) is
  // responsible for turning this into the contract's 502 `UPSTREAM_ERROR`;
  // `GET /api/cron/retry-notice-emails` (B22/B23, out of this task's scope)
  // is what eventually retries dispatch.
  return { ok: true, notice };
}

/**
 * Exported so `lib/jobs/retry-notice-emails.ts` (B22) can re-render the
 * SAME content this route sends on first attempt. There is only one
 * implemented notice version today (`DIRECT_NOTICE_VERSION`), so a retry
 * always resends the CURRENT copy regardless of the stale row's own
 * `noticeVersion` — there is no archived-by-version copy store to render an
 * older version from. If a second notice version ever ships, this becomes
 * incorrect for old rows and needs a real per-version copy lookup; flagged
 * here rather than silently assumed.
 */
export function renderNoticeText(): string {
  const c = DIRECT_NOTICE_COPY;
  const lines = [
    "This is a notice about the personal information we collect from your child.",
    "",
    "What we collect:",
    ...c.collected.map((item) => `- ${item}`),
    "",
    "How it's used:",
    ...c.uses.map((item) => `- ${item}`),
    "",
    "Who else receives it:",
    ...c.thirdParties.map((tp) => `- ${tp.name}: ${tp.receives}`),
    "",
    "Your rights as a parent:",
    ...c.rights.map((item) => `- ${item}`),
    "",
    `Retention policy: ${c.retentionPolicyPath}`,
    `Privacy policy: ${c.privacyPolicyPath}`,
  ];
  return lines.join("\n");
}

export function renderNoticeHtml(): string {
  const c = DIRECT_NOTICE_COPY;
  const list = (items: readonly string[]) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return [
    "<p>This is a notice about the personal information we collect from your child.</p>",
    "<p><strong>What we collect:</strong></p>",
    list(c.collected),
    "<p><strong>How it's used:</strong></p>",
    list(c.uses),
    "<p><strong>Who else receives it:</strong></p>",
    `<ul>${c.thirdParties.map((tp) => `<li><strong>${escapeHtml(tp.name)}</strong>: ${escapeHtml(tp.receives)}</li>`).join("")}</ul>`,
    "<p><strong>Your rights as a parent:</strong></p>",
    list(c.rights),
    `<p><a href="${c.retentionPolicyPath}">Retention policy</a> &middot; <a href="${c.privacyPolicyPath}">Privacy policy</a></p>`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
