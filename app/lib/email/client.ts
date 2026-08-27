import "server-only";

const RESEND_API_URL = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = {
  /**
   * True ONLY when a real transport (Resend) accepted the message for
   * delivery. Never true for the console transport — a caller that stamps
   * a compliance timestamp from this (e.g. `DirectNotice.sentAt`, AC 14)
   * must never be told a message was delivered when it was only logged.
   */
  delivered: boolean;
  /**
   * An opaque reference. For a real transport, Resend's own message id.
   * For the console transport, a `console:`-prefixed placeholder — callers
   * MUST NOT treat a non-null `deliveryRef` as proof of delivery; check
   * `delivered` instead. Never a token, never a secret, never the message
   * body.
   */
  deliveryRef: string | null;
};

/**
 * The one function in the app that talks to Resend — a plain `fetch` to its
 * HTTP API (ADR-0002: no mail SDK, no SMTP client).
 *
 * The console transport is opt-in via the EXPLICIT `EMAIL_TRANSPORT=console`
 * env var (`.env.example`) — not inferred from `NODE_ENV`. `NODE_ENV` is set
 * by the framework/build tooling for reasons that have nothing to do with
 * whether an operator wants real email sent (a `next build` in a CI
 * pipeline that happens to run with `NODE_ENV=production` unset is not a
 * declaration "this run should actually email people"), and a prior
 * version of this gate also logged `input.text` in full — which for the
 * sign-in magic link IS the full magic-link URL, a live credential landing
 * in whatever aggregates server logs.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (process.env.EMAIL_TRANSPORT === "console") {
    // Recipient and subject only — never `input.text`/`input.html`, which
    // for the sign-in magic link and the EMAIL_PLUS consent-confirmation
    // message both carry a live, single-use token URL.
    console.log(`[email:console] to=${input.to} subject=${JSON.stringify(input.subject)}`);
    // `delivered: false` is deliberate, not a bug: nothing left this
    // process. A caller must never stamp a compliance timestamp (e.g.
    // AC 14's `DirectNotice.sentAt`) off this result.
    return { delivered: false, deliveryRef: `console:${Date.now()}` };
  }

  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.error(
      "AUTH_RESEND_KEY or EMAIL_FROM is not set, and EMAIL_TRANSPORT is not \"console\" — cannot send email.",
    );
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
