import "server-only";

const RESEND_API_URL = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = {
  delivered: boolean;
  /** Provider message id, when known. Never a token, never a secret. */
  deliveryRef: string | null;
};

/**
 * The one function in the app that talks to Resend — a plain `fetch` to its
 * HTTP API (ADR-0002: no mail SDK, no SMTP client).
 *
 * In any non-production environment the message is written to the server
 * console instead of sent, so local development, CI and Vitest never need a
 * real `AUTH_RESEND_KEY` (plan §5.1, B2). `send-magic-link.ts`,
 * `send-direct-notice.ts` and `send-consent-confirmation.ts` are the three
 * distinct callers — three distinct message types, three distinct token
 * spaces (ADR-0002 revision note) — and none of them talk to Resend
 * directly.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[email:dev] to=${input.to} subject=${JSON.stringify(input.subject)}\n${input.text}`,
    );
    return { delivered: true, deliveryRef: `dev-console-${Date.now()}` };
  }

  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.error("AUTH_RESEND_KEY or EMAIL_FROM is not set; cannot send email in production.");
    return { delivered: false, deliveryRef: null };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!res.ok) {
      console.error(`Resend API responded with status ${res.status}`);
      return { delivered: false, deliveryRef: null };
    }

    // `id` is the only field of Resend's response body this app reads.
    const body: unknown = await res.json().catch(() => null);
    const deliveryRef =
      body && typeof body === "object" && "id" in body && typeof body.id === "string"
        ? body.id
        : null;
    return { delivered: true, deliveryRef };
  } catch (err) {
    // Never surface the raw error to a caller that might put it in a
    // response body (M1 AC 24) — log it and report a plain delivery failure.
    console.error("Resend API request failed", err);
    return { delivered: false, deliveryRef: null };
  }
}
