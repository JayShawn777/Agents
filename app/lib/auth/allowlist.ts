import { normalizeEmail } from "@/lib/auth/normalize-email";

/**
 * Invite-only sign-in, for the period when the only users are the owner's own
 * family (2026-10-12 owner decision: speed first, parent-facing compliance work
 * deferred until the app opens to other families).
 *
 * `ALLOWED_SIGNUP_EMAILS` is a comma- or whitespace-separated list. **Unset or
 * empty means OPEN** — the shipped behaviour, so tests and any deployment that
 * does not opt in are unchanged. That default is deliberate and is also the
 * footgun: a deployment that forgets the variable is open to anyone, so the
 * deploy checklist lists it, and the sign-in page cannot tell you which mode it
 * is in because revealing that would reveal the list.
 *
 * Read per call, not at import, so a changed environment variable takes effect
 * on the next request without a rebuild.
 *
 * This is a GATE, not an authorisation model: it does not replace the 18+
 * attestation or consent flows, which stay exactly as built. It only decides who
 * may start them. Removing it later is deleting the variable.
 */
export function isSignupAllowed(rawEmail: string): boolean {
  const list = process.env.ALLOWED_SIGNUP_EMAILS?.split(/[\s,]+/).filter(Boolean);
  if (!list || list.length === 0) return true;
  const email = normalizeEmail(rawEmail);
  return list.some((entry) => normalizeEmail(entry) === email);
}
