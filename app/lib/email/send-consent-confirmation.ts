import "server-only";

import { sendEmail, type SendEmailResult } from "@/lib/email/client";

export type SendConsentConfirmationEmailInput = {
  to: string;
  consentingAdultName: string;
  /** Opens the public, session-free confirmation page — never a mutating GET (ADR-0008 §5). */
  verifyUrl: string;
  /** The "this was not me" control, rendered on the same page. */
  declineUrl: string;
  expiresAt: Date;
};

/**
 * The `EMAIL_PLUS` confirmatory message (ADR-0008 §4/§5) — for `EMAIL_PLUS`,
 * following this link's page and clicking its explicit "Yes, I consent"
 * control IS parental consent. A third, distinct token space from both the
 * sign-in magic link (Auth.js's own `VerificationToken`) and the notice
 * email (which carries no token at all): this one is a
 * `ConsentVerificationChallenge`, single-use and hashed at rest
 * (ADR-0002 revision note, ADR-0008 §4). Never reuse `VerificationToken`
 * for this.
 *
 * `verifyUrl` and `declineUrl` must each open a page with an explicit
 * control and must never auto-consent on GET — a corporate mail scanner
 * following the link must not be able to grant consent (ADR-0008 §5). That
 * page (`app/(public)/consent/verify/[token]/**`) and the routes it posts
 * to (B12) are both out of this task's scope (B1-B8); this function only
 * sends the email.
 */
export async function sendConsentConfirmationEmail(
  input: SendConsentConfirmationEmailInput,
): Promise<SendEmailResult> {
  const hours = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 3_600_000));
  return sendEmail({
    to: input.to,
    subject: "Confirm you consent to your child's account",
    text: [
      `Hi ${input.consentingAdultName},`,
      "",
      `To confirm you consent, open this link within about ${hours} hours:`,
      input.verifyUrl,
      "",
      "If this wasn't you, let us know instead:",
      input.declineUrl,
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(input.consentingAdultName)},</p>`,
      `<p>To confirm you consent, open this link within about ${hours} hours:</p>`,
      `<p><a href="${input.verifyUrl}">${input.verifyUrl}</a></p>`,
      `<p>If this wasn't you, let us know instead: <a href="${input.declineUrl}">${input.declineUrl}</a></p>`,
    ].join("\n"),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
