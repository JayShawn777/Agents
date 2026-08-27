import "@testing-library/jest-dom/vitest";

// Vitest does not load `.env` automatically the way `next dev`/`prisma`
// do (confirmed: `process.env` is empty for anything only `.env` defines).
// `dotenv/config` fills gaps in `process.env` from `.env` without
// overriding anything already set (e.g. by CI) — needed for
// `DATABASE_URL` (the one real-database integration test,
// `tests/integration/`) and for the fallbacks below.
import "dotenv/config";

/**
 * Module-load-time env vars that `lib/config.ts` and `lib/consent/audit.ts`
 * require even outside a real request (ADR-0008 §2: "a bad or unimplemented
 * value fails the boot"). Applied only if `.env` (loaded above) didn't
 * already set them.
 *
 * `CONSENT_METHOD` defaults here to PRODUCTION's real value, `EMAIL_PLUS`,
 * rather than a placeholder, so a test exercises the same configured method
 * a deployed instance does. Before this file set it, `vitest.config.mts`'s
 * `jsdom` environment made `resolveConsentMethod()`'s
 * `typeof window !== "undefined"` branch true in every test, which
 * returned `CONSENT_METHODS[0]` (`SIGNED_FORM`) — a client-side inert
 * placeholder never meant to be read — silently masking the fact that no
 * test ever exercised the real branch.
 *
 * `??=` so a test file that needs a different value can `vi.stubEnv(...)`
 * before its own imports without this file fighting it.
 */
process.env.CONSENT_METHOD ??= "EMAIL_PLUS";
// Never a real secret — this file is committed. Any deletion-path test that
// hashes an adult's identity (`lib/consent/audit.ts`) needs SOME key
// present at module load; determinism/reversibility don't matter for a
// fixture.
process.env.AUDIT_PSEUDONYM_KEY ??= "test-only-audit-pseudonym-key-do-not-use-in-prod";
// `lib/email/client.ts`'s console transport is opt-in and explicit
// (EMAIL_TRANSPORT=console) precisely so nothing sends real email by
// accident — including from this test suite, which has no real
// AUTH_RESEND_KEY and must never attempt a live Resend call.
process.env.EMAIL_TRANSPORT ??= "console";
