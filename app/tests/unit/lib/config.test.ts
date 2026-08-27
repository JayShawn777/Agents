import { describe, expect, it } from "vitest";

/**
 * Pins the item-8 fix: under the previous `jsdom`-by-default Vitest config,
 * `resolveConsentMethod()`'s `typeof window !== "undefined"` branch was true
 * in every test (jsdom polyfills `window`), so `CONSENT_METHOD` resolved to
 * `CONSENT_METHODS[0]` (`SIGNED_FORM`) — an inert client-side placeholder —
 * regardless of the real `CONSENT_METHOD` env var
 * (`vitest.setup.ts` sets it to production's actual value, `EMAIL_PLUS`).
 * Under the `node` default this file now exercises the real branch, so this
 * constant must match what a deployed instance actually configures.
 */
describe("lib/config.ts CONSENT_METHOD", () => {
  it("resolves the real server-side value (EMAIL_PLUS), not the client placeholder (SIGNED_FORM)", async () => {
    const { CONSENT_METHOD } = await import("@/lib/config");
    expect(CONSENT_METHOD).toBe("EMAIL_PLUS");
    expect(CONSENT_METHOD).not.toBe("SIGNED_FORM");
  });

  it("typeof window is undefined under the default node test environment", () => {
    expect(typeof window).toBe("undefined");
  });
});
