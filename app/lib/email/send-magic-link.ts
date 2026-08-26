import "server-only";

import { sendEmail, type SendEmailResult } from "@/lib/email/client";

export type SendMagicLinkEmailInput = {
  to: string;
  url: string;
  expiresAt: Date;
};

/**
 * The sign-in magic link (AC 3, AC 4). Called from the custom `type:
 * "email"` provider's `sendVerificationRequest` (`lib/auth/config.ts`).
 *
 * Token space: Auth.js's own `VerificationToken` table, single-use,
 * deleted on redemption. Nothing in the consent flow may ever reuse this
 * table or this token space (ADR-0002 revision note) — see
 * `send-consent-confirmation.ts` for the separate `EMAIL_PLUS` token.
 */
export async function sendMagicLinkEmail({
  to,
  url,
  expiresAt,
}: SendMagicLinkEmailInput): Promise<SendEmailResult> {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  return sendEmail({
    to,
    subject: "Your sign-in link",
    text: [
      `Sign in by following this link (expires in about ${minutes} minutes):`,
      url,
      "",
      "If you didn't request this, you can ignore this email.",
    ].join("\n"),
    html: [
      `<p>Sign in by following this link (expires in about ${minutes} minutes):</p>`,
      `<p><a href="${url}">${url}</a></p>`,
      "<p>If you didn't request this, you can ignore this email.</p>",
    ].join("\n"),
  });
}
