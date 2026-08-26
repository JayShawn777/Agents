import "server-only";

import { sendEmail, type SendEmailResult } from "@/lib/email/client";

export type SendDirectNoticeEmailInput = {
  to: string;
  /** The §312.4 notice version this content was rendered under (AC 14). */
  noticeVersion: string;
  /**
   * Rendered HTML/text body — the SAME content shown on the direct-notice
   * screen (AC 14: "the same notice content is emailed"). Built from the
   * versioned notice copy module; that module is B9's job and is out of
   * this task's scope (B1-B8).
   */
  html: string;
  text: string;
};

/**
 * The §312.4 direct-notice email (AC 14). A distinct message type from both
 * the sign-in magic link and the `EMAIL_PLUS` consent-confirmation message
 * (ADR-0002 revision note) — this one carries no token at all, so there is
 * no token space to protect; the record of what was sent lives in the
 * `DirectNotice` row (`sentAt`, `noticeVersion`), written by the caller
 * (B9), not here.
 */
export async function sendDirectNoticeEmail(
  input: SendDirectNoticeEmailInput,
): Promise<SendEmailResult> {
  return sendEmail({
    to: input.to,
    subject: "Notice about your child's information",
    html: input.html,
    text: input.text,
  });
}
