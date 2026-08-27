import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkPublicConsentRateLimit,
  extractClientIp,
  resetPublicConsentRateLimitForTests,
} from "@/lib/consent/rate-limit";

beforeEach(() => {
  resetPublicConsentRateLimitForTests();
  vi.useRealTimers();
});

describe("checkPublicConsentRateLimit", () => {
  it("allows attempts up to the configured max within the window", () => {
    const config = { windowMs: 60_000, maxAttempts: 3 };
    expect(checkPublicConsentRateLimit("k1", config)).toBe(true);
    expect(checkPublicConsentRateLimit("k1", config)).toBe(true);
    expect(checkPublicConsentRateLimit("k1", config)).toBe(true);
  });

  it("denies the attempt once the max is exceeded within the window", () => {
    const config = { windowMs: 60_000, maxAttempts: 2 };
    expect(checkPublicConsentRateLimit("k2", config)).toBe(true);
    expect(checkPublicConsentRateLimit("k2", config)).toBe(true);
    expect(checkPublicConsentRateLimit("k2", config)).toBe(false);
    // A sustained flood keeps being denied, not oscillating back to allowed.
    expect(checkPublicConsentRateLimit("k2", config)).toBe(false);
  });

  it("keys are independent — a flood against one key never throttles another", () => {
    const config = { windowMs: 60_000, maxAttempts: 1 };
    expect(checkPublicConsentRateLimit("victim-a", config)).toBe(true);
    expect(checkPublicConsentRateLimit("victim-a", config)).toBe(false);
    expect(checkPublicConsentRateLimit("victim-b", config)).toBe(true);
  });

  it("attempts older than the window expire and free up capacity", () => {
    vi.useFakeTimers();
    const config = { windowMs: 1000, maxAttempts: 1 };
    expect(checkPublicConsentRateLimit("k3", config)).toBe(true);
    expect(checkPublicConsentRateLimit("k3", config)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(checkPublicConsentRateLimit("k3", config)).toBe(true);
    vi.useRealTimers();
  });
});

describe("extractClientIp", () => {
  it("reads the first hop of x-forwarded-for", () => {
    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(extractClientIp(req)).toBe("203.0.113.9");
  });

  it("returns null when the header is absent", () => {
    const req = new Request("http://localhost/");
    expect(extractClientIp(req)).toBeNull();
  });
});
