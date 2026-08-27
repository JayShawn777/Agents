import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// `lib/auth/dal.ts` (this file's default session source) transitively
// imports `lib/auth/config.ts`, which configures real Auth.js against
// `next-auth` and our Prisma client. None of that belongs in a unit test of
// `withAuth()`'s check ORDERING — every test below injects its own
// `getSession`, so the real module is never actually called, but it still
// has to import cleanly. Mocking it here keeps this suite fast and free of
// any real database/Auth.js dependency.
vi.mock("@/lib/auth/dal", () => ({
  verifySession: async () => null,
}));

const { withAuth } = await import("@/lib/api/handler");
type SessionInfo = { userId: string };

/**
 * ADR-0006 fixes a strict, load-bearing check order for `withAuth()`:
 *
 *   1. session (401) -> 2. origin (403) -> 3. resource (404) ->
 *   4. consent-state gate (403) -> 5. flow precondition (409) ->
 *   6. body schema (400) -> 7. rate limit (429)
 *
 * Every test below configures MULTIPLE checks to fail simultaneously and
 * asserts only the earliest one in the list produced the response — this
 * is what actually pins the order down. A suite that only ever fails one
 * check at a time would pass even if a refactor silently swapped two steps.
 */

const SESSION: SessionInfo = { userId: "user_1" };

type Resource = { status: "ACTIVE" | "NOTICE_PENDING" };
const ACTIVE_RESOURCE: Resource = { status: "ACTIVE" };
const PENDING_RESOURCE: Resource = { status: "NOTICE_PENDING" };

const rejectingBodySchema = z.object({ mustNotMatch: z.literal("never") }).strict();
const permissiveBodySchema = z.object({}).strict();

function req(opts: {
  method?: string;
  origin?: string | null;
  secFetchSite?: string | null;
  body?: unknown;
} = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null && opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.secFetchSite !== null && opts.secFetchSite !== undefined) {
    headers["sec-fetch-site"] = opts.secFetchSite;
  }
  const method = opts.method ?? "POST";
  const hasBody = opts.body !== undefined && method !== "GET" && method !== "HEAD";
  return new Request("http://localhost/api/test/abc", {
    method,
    headers: hasBody ? { ...headers, "content-type": "application/json" } : headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
}

function ctx(params: Record<string, string> = { studentId: "abc" }) {
  return { params: Promise.resolve(params) };
}

async function statusAndBody(res: Response) {
  const body = (await res.json()) as { ok: boolean; error?: { code: string } };
  return { status: res.status, code: body.ok ? null : body.error?.code };
}

const okHandler = async () => new Response(JSON.stringify({ ok: true, data: { handled: true } }), { status: 200 });

describe("withAuth() misconfiguration fails the boot, not the request", () => {
  it("throws synchronously when requireState is configured without resolveResource", () => {
    expect(() =>
      withAuth<Resource, unknown>({
        requireState: () => false,
        handler: okHandler,
      }),
    ).toThrow(/resolveResource/);
  });

  it("throws synchronously when requireFlow is configured without resolveResource", () => {
    expect(() =>
      withAuth<Resource, unknown>({
        requireFlow: async () => false,
        handler: okHandler,
      }),
    ).toThrow(/resolveResource/);
  });

  it("does not throw when resolveResource is present alongside requireState/requireFlow", () => {
    expect(() =>
      withAuth<Resource, unknown>({
        resolveResource: async () => ACTIVE_RESOURCE,
        requireState: () => true,
        requireFlow: async () => true,
        handler: okHandler,
      }),
    ).not.toThrow();
  });
});

describe("withAuth() check ordering (ADR-0006)", () => {
  it("1) 401 when there is no session, even though every later check would also fail", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => null,
      resolveResource: async () => null, // would be 404
      requireState: () => false, // would be 403
      bodySchema: rejectingBodySchema, // would be 400
      handler: okHandler,
    });

    const res = await handler(req({ origin: "https://evil.example" }), ctx());
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(401);
    expect(code).toBe("UNAUTHENTICATED");
  });

  it("2) 403 (origin) beats 404 (resource) when both would fail", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => SESSION,
      resolveResource: async () => null, // would be 404
      handler: okHandler,
    });

    const res = await handler(req({ origin: "https://evil.example" }), ctx());
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(403);
    expect(code).toBe("FORBIDDEN");
  });

  it("2) the origin check is skipped for GET (no body-mutating same-origin requirement)", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      handler: okHandler,
    });

    const res = await handler(req({ method: "GET", origin: "https://evil.example" }), ctx());
    const { status } = await statusAndBody(res);
    expect(status).toBe(200);
  });

  it("3) 404 (resource) beats 403 (consent gate) and 400 (body) when all three would fail", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => SESSION,
      resolveResource: async () => null, // 404
      requireState: () => false, // would be 403
      bodySchema: rejectingBodySchema, // would be 400
      handler: okHandler,
    });

    const res = await handler(req({ origin: "http://localhost", body: { anything: true } }), ctx());
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(404);
    expect(code).toBe("NOT_FOUND");
  });

  it("4) THE LOAD-BEARING CASE (M0 AC 11): consent-state 403 beats body-validation 400 — an invalid body against a non-ACTIVE resource is still 403, never 400", async () => {
    const handler = withAuth<Resource, { mustNotMatch: "never" }>({
      getSession: async () => SESSION,
      resolveResource: async () => PENDING_RESOURCE,
      requireState: (resource) => resource.status === "ACTIVE", // fails -> 403
      bodySchema: rejectingBodySchema, // an otherwise-invalid body would be 400
      handler: okHandler,
    });

    const res = await handler(
      req({ origin: "http://localhost", body: { totallyInvalid: "yes" } }),
      ctx(),
    );
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(403);
    expect(code).toBe("FORBIDDEN");
  });

  it("4) consent-state gate passes through when the resource is ACTIVE", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      requireState: (resource) => resource.status === "ACTIVE",
      handler: okHandler,
    });

    const res = await handler(req({ origin: "http://localhost" }), ctx());
    expect(res.status).toBe(200);
  });

  it("5) 409 (flow precondition) beats 400 (body) when both would fail", async () => {
    const handler = withAuth<Resource, { mustNotMatch: "never" }>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      requireState: () => true,
      requireFlow: async () => false, // 409
      bodySchema: rejectingBodySchema, // would be 400
      handler: okHandler,
    });

    const res = await handler(
      req({ origin: "http://localhost", body: { totallyInvalid: "yes" } }),
      ctx(),
    );
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(409);
    expect(code).toBe("CONFLICT");
  });

  it("6) 400 with fieldErrors when the body fails zod, after every earlier check passes", async () => {
    const handler = withAuth<Resource, { mustNotMatch: "never" }>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      requireState: () => true,
      requireFlow: async () => true,
      bodySchema: rejectingBodySchema,
      handler: okHandler,
    });

    const res = await handler(
      req({ origin: "http://localhost", body: { totallyInvalid: "yes" } }),
      ctx(),
    );
    const body = (await res.json()) as { ok: false; error: { code: string; fieldErrors?: Record<string, string[]> } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fieldErrors).toBeTruthy();
  });

  it("4 vs 5) consent-state 403 beats flow-precondition 409 when both would fail — pins step 4 above step 5 (a reordered handler that ran 5 before 4 goes red here)", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => SESSION,
      resolveResource: async () => PENDING_RESOURCE,
      requireState: () => false, // would be 403
      requireFlow: async () => false, // would be 409
      handler: okHandler,
    });

    const res = await handler(req({ origin: "http://localhost" }), ctx());
    const { status, code } = await statusAndBody(res);
    // 403 (permanent bar: this profile is not consented) must win over 409
    // (retryable: "you skipped a step") — collapsing them the other way
    // turns "this child is not consented" into "you skipped a step".
    expect(status).toBe(403);
    expect(code).toBe("FORBIDDEN");
  });

  it("6 vs 7) body-validation 400 beats rate-limit 429 when both would fail — pins step 6 above step 7 (a reordered handler that ran 7 before 6 goes red here)", async () => {
    const handler = withAuth<Resource, { mustNotMatch: "never" }>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      requireState: () => true,
      requireFlow: async () => true,
      bodySchema: rejectingBodySchema, // would be 400
      rateLimit: async () => false, // would be 429
      handler: okHandler,
    });

    const res = await handler(
      req({ origin: "http://localhost", body: { totallyInvalid: "yes" } }),
      ctx(),
    );
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(400);
    expect(code).toBe("VALIDATION_ERROR");
  });

  it("7) 429 (rate limit) beats a successful body parse's own result — evaluated only after the body is valid", async () => {
    const handler = withAuth<Resource, Record<string, never>>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      requireState: () => true,
      requireFlow: async () => true,
      bodySchema: permissiveBodySchema,
      rateLimit: async () => false,
      handler: okHandler,
    });

    const res = await handler(req({ origin: "http://localhost", body: {} }), ctx());
    const { status, code } = await statusAndBody(res);
    expect(status).toBe(429);
    expect(code).toBe("RATE_LIMITED");
  });

  it("runs the handler and returns its response only once every check has passed", async () => {
    const handler = withAuth<Resource, Record<string, never>>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      requireState: () => true,
      requireFlow: async () => true,
      bodySchema: permissiveBodySchema,
      rateLimit: async () => true,
      handler: async ({ session, resource }) => {
        expect(session).toEqual(SESSION);
        expect(resource).toEqual(ACTIVE_RESOURCE);
        return new Response(JSON.stringify({ ok: true, data: { reached: true } }), { status: 200 });
      },
    });

    const res = await handler(req({ origin: "http://localhost", body: {} }), ctx());
    const body = (await res.json()) as { ok: true; data: { reached: boolean } };
    expect(res.status).toBe(200);
    expect(body.data.reached).toBe(true);
  });

  it("public mode skips the session check entirely and passes session: null to the handler", async () => {
    const handler = withAuth<undefined, unknown>({
      mode: "public",
      getSession: async () => null,
      handler: async ({ session }) => {
        expect(session).toBeNull();
        return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
      },
    });

    const res = await handler(req({ origin: "http://localhost" }), ctx());
    expect(res.status).toBe(200);
  });

  it("maps an unhandled error thrown by the inner handler to a typed 500, never the raw message", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => SESSION,
      resolveResource: async () => ACTIVE_RESOURCE,
      handler: async () => {
        throw new Error("some sensitive internal detail");
      },
    });

    const res = await handler(req({ origin: "http://localhost" }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string; message: string } };
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("sensitive internal detail");
  });

  it("every response carries Cache-Control: no-store", async () => {
    const handler = withAuth<Resource, unknown>({
      getSession: async () => null,
      handler: okHandler,
    });
    const res = await handler(req(), ctx());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
