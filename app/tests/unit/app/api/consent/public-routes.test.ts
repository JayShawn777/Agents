import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyConsentMock = vi.fn();
const declineConsentMock = vi.fn();

vi.mock("@/lib/consent/service", () => ({
  verifyConsent: verifyConsentMock,
  declineConsent: declineConsentMock,
}));

// `withAuth()`'s default `getSession` is `verifySession` (`lib/auth/dal.ts`),
// which transitively imports the real Auth.js config even for these
// session-free (`mode: "public"`) routes — `getSession().catch(() => null)`
// still calls it. Mocked here for the same reason
// `tests/unit/lib/api/handler.test.ts` mocks it: no real Auth.js/Prisma
// dependency in a unit test of route wiring.
vi.mock("@/lib/auth/dal", () => ({
  verifySession: async () => null,
}));

// Real rate limiter (not mocked) — each test resets it so requests from
// earlier tests don't bleed into later ones via the shared in-memory map.
const { resetPublicConsentRateLimitForTests } = await import("@/lib/consent/rate-limit");

const { POST: verifyPOST } = await import("@/app/api/consent/verify/route");
const { POST: declinePOST } = await import("@/app/api/consent/decline/route");
const { POST: callbackPOST } = await import("@/app/api/consent/callback/[method]/route");

function req(url: string, body: unknown, ip = "203.0.113.9") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function ctx(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

const TOKEN = "a".repeat(43); // within [32,256]

beforeEach(() => {
  vi.clearAllMocks();
  resetPublicConsentRateLimitForTests();
});

describe("POST /api/consent/verify (endpoint 9) — public, session-free", () => {
  it("requires no session — a null session still reaches the handler", async () => {
    verifyConsentMock.mockResolvedValue({ ok: true, student: { id: "sp_1", status: "ACTIVE" } });
    const res = await verifyPOST(req("http://localhost/api/consent/verify", { token: TOKEN }), ctx());
    expect(res.status).toBe(200);
  });

  it("400s on a too-short token, and never calls verifyConsent", async () => {
    const res = await verifyPOST(req("http://localhost/api/consent/verify", { token: "short" }), ctx());
    expect(res.status).toBe(400);
    expect(verifyConsentMock).not.toHaveBeenCalled();
  });

  it("404s for NOT_FOUND", async () => {
    verifyConsentMock.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const res = await verifyPOST(req("http://localhost/api/consent/verify", { token: TOKEN }), ctx());
    expect(res.status).toBe(404);
  });

  it("409s for EXPIRED/ALREADY_USED", async () => {
    verifyConsentMock.mockResolvedValue({ ok: false, code: "EXPIRED" });
    const res = await verifyPOST(req("http://localhost/api/consent/verify", { token: TOKEN }), ctx());
    expect(res.status).toBe(409);
  });

  it("200s with { verified: true } on success, and never leaks the token back", async () => {
    verifyConsentMock.mockResolvedValue({ ok: true, student: { id: "sp_1", status: "ACTIVE" } });
    const res = await verifyPOST(req("http://localhost/api/consent/verify", { token: TOKEN }), ctx());
    const body = (await res.json()) as { ok: true; data: { verified: true } };
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ verified: true });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("THE LOAD-BEARING CASE: rate-limits by IP BEFORE ever calling verifyConsent — a flood of wrong tokens is throttled, not a free 404 each time", async () => {
    verifyConsentMock.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const attackerIp = "198.51.100.7";
    const results: number[] = [];
    // CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS defaults to 20 (lib/config.ts) —
    // send one more than that from the SAME ip and expect the last to be 429.
    for (let i = 0; i < 21; i++) {
      const res = await verifyPOST(
        req("http://localhost/api/consent/verify", { token: TOKEN }, attackerIp),
        ctx(),
      );
      results.push(res.status);
    }
    expect(results.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(results[20]).toBe(429);
  });

  it("a DIFFERENT ip is never throttled by another caller's flood", async () => {
    verifyConsentMock.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    for (let i = 0; i < 25; i++) {
      await verifyPOST(req("http://localhost/api/consent/verify", { token: TOKEN }, "198.51.100.7"), ctx());
    }
    const res = await verifyPOST(
      req("http://localhost/api/consent/verify", { token: TOKEN }, "198.51.100.99"),
      ctx(),
    );
    expect(res.status).toBe(404); // not 429
  });
});

describe("POST /api/consent/decline (endpoint 10) — public, session-free", () => {
  it("200s with { declined: true } on success", async () => {
    declineConsentMock.mockResolvedValue({ ok: true });
    const res = await declinePOST(req("http://localhost/api/consent/decline", { token: TOKEN }), ctx());
    const body = (await res.json()) as { ok: true; data: { declined: true } };
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ declined: true });
  });

  it("404s for NOT_FOUND, 409 for EXPIRED/ALREADY_USED", async () => {
    declineConsentMock.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    expect((await declinePOST(req("http://localhost/api/consent/decline", { token: TOKEN }), ctx())).status).toBe(404);

    declineConsentMock.mockResolvedValue({ ok: false, code: "ALREADY_USED" });
    expect((await declinePOST(req("http://localhost/api/consent/decline", { token: TOKEN }), ctx())).status).toBe(409);
  });
});

describe("POST /api/consent/callback/[method] (endpoint 11) — specified now, no live target yet", () => {
  it("404s for every method value — honest, not a stand-in success", async () => {
    for (const method of ["EMAIL_PLUS", "PAYMENT_CARD", "totally-unknown"]) {
      const res = await callbackPOST(
        req(`http://localhost/api/consent/callback/${method}`, {}),
        ctx({ method }),
      );
      expect(res.status).toBe(404);
    }
  });

  it("is still rate-limited per IP even though it 404s for everything today", async () => {
    for (let i = 0; i < 21; i++) {
      await callbackPOST(
        req("http://localhost/api/consent/callback/EMAIL_PLUS", {}, "198.51.100.44"),
        ctx({ method: "EMAIL_PLUS" }),
      );
    }
    const res = await callbackPOST(
      req("http://localhost/api/consent/callback/EMAIL_PLUS", {}, "198.51.100.44"),
      ctx({ method: "EMAIL_PLUS" }),
    );
    expect(res.status).toBe(429);
  });
});
