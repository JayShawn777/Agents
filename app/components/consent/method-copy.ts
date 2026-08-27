/**
 * Copy for the consent-flow screens, keyed by `ConsentMethodProvider.stepCopyId`
 * (`lib/consent/methods/port.ts`) — never by `ConsentMethod` itself (ADR-0008
 * §3: "no route, DAL function or component may branch on `ConsentMethod`").
 * `stepCopyId` is the opaque, versioned identifier the provider interface
 * exists to expose for exactly this purpose, so swapping the configured
 * method only ever means adding an entry here, never branching logic in a
 * page or form.
 *
 * Frontend-owned (not `lib/consent/`, which this milestone's scope excludes
 * editing) — this is presentation copy, not consent logic. An unrecognized
 * `stepCopyId` (a retired method with no live copy, or a method that ships
 * later without a copy update landing first) falls back to a generic,
 * still-accurate description rather than rendering nothing.
 */

export type ConsentMethodCopy = {
  /** Shown on the consent step itself, before the parent submits. */
  beforeSubmit: string;
  /** Shown on the "waiting for confirmation" screen after submission. */
  pending: { title: string; body: readonly string[] };
};

const CONSENT_METHOD_COPY: Record<string, ConsentMethodCopy> = {
  "email-plus.v1": {
    beforeSubmit:
      "After you submit this form, we'll send a confirmation email to the address on your account. This student's profile stays inactive until you open that email and click the confirmation link — nothing is activated by this form alone.",
    pending: {
      title: "Check your email",
      body: [
        "We've sent a confirmation email to the address on your account.",
        "Open it and click the button inside to finish giving consent for this student.",
        "The link expires after a while, so please check soon — and check your spam folder if you don't see it.",
      ],
    },
  },
};

const FALLBACK_COPY: ConsentMethodCopy = {
  beforeSubmit:
    "After you submit this form, we'll ask you to complete one more verification step before this profile becomes active.",
  pending: {
    title: "One more step",
    body: [
      "We're waiting on a verification step to finish before this profile can become active.",
    ],
  },
};

export function getConsentMethodCopy(stepCopyId: string): ConsentMethodCopy {
  return CONSENT_METHOD_COPY[stepCopyId] ?? FALLBACK_COPY;
}
