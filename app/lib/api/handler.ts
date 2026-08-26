import "server-only";

import type { ZodType } from "zod";
import { z } from "zod";

import { apiErr, errorResponse, type ApiResult } from "@/lib/errors";
import { verifySession, type SessionInfo } from "@/lib/auth/dal";

/**
 * `withAuth()` — the seven ordered checks from ADR-0006, run in this exact
 * order, stopping at the first failure:
 *
 *   1. Session present                                   -> 401
 *   2. Same-origin `Origin`/`Sec-Fetch-Site` (non-GET)    -> 403
 *   3. Resource resolves under `userId`                   -> 404
 *   4. Consent-state gate (e.g. `status === 'ACTIVE'`)    -> 403
 *   5. Flow-order precondition                            -> 409
 *   6. zod parse of the body                               -> 400 + fieldErrors
 *   7. Rate limit                                          -> 429
 *
 * Step 4 sitting above step 6 is deliberate and load-bearing (M0 AC 11): a
 * direct POST carrying an invalid body against a non-`ACTIVE` profile must
 * still be 403, not 400 — a 400 would tell an attacker the field shape was
 * the problem and that the profile is otherwise writable. See
 * `tests/unit/lib/api/handler.test.ts` for the ordering test this
 * docstring promises.
 *
 * This is the ONLY place any route handler resolves a session or checks
 * consent state. A handler's `run` callback receives already-validated,
 * already-authorized inputs and does nothing but the mutation/read itself.
 */

export type WithAuthArgs<TResource, TBody> = {
  req: Request;
  params: Record<string, string>;
  /** `null` only when `mode: "public"` and no session cookie was sent. */
  session: SessionInfo | null;
  resource: TResource;
  body: TBody;
};

export type WithAuthConfig<TResource = undefined, TBody = undefined> = {
  /**
   * `"session"` (default) requires step 1 to pass. `"public"` skips step 1
   * entirely — for the session-free, token-authenticated endpoints (plan
   * §3.2 #9 `/api/consent/verify`, #10 `/api/consent/decline`; both out of
   * this task's scope but the mode exists for them per B7's brief).
   */
  mode?: "session" | "public";

  /**
   * Step 3. Resolves the resource this route acts on, scoped to the
   * caller — e.g. `requireStudentProfile(params.studentId)`
   * (`lib/auth/dal.ts`). Omit for routes with no path resource (e.g.
   * `POST /api/students`). Returning `null`/`undefined` is a 404: a
   * cross-account id and a nonexistent id must be indistinguishable
   * (AC 32, M1 AC 33).
   */
  resolveResource?: (args: {
    req: Request;
    params: Record<string, string>;
    session: SessionInfo | null;
  }) => Promise<TResource | null | undefined> | TResource | null | undefined;

  /**
   * Step 4, THE CONSENT-STATE GATE. Only consulted when `resolveResource`
   * ran and resolved a resource. Returning `false` is a 403, evaluated
   * strictly before the body is read (M0 AC 11) — do not move body parsing
   * above this check.
   */
  requireState?: (resource: TResource) => boolean;
  /** Overrides the default FORBIDDEN message. Must still be an allowlisted, user-safe string (`lib/errors.ts`). */
  requireStateMessage?: string;

  /**
   * Step 5. A flow-order precondition — e.g. "a `DirectNotice` row exists
   * for this profile" (AC 15). Returning `false` is a 409: the resource is
   * at the wrong step of a flow and another request is the fix.
   */
  requireFlow?: (args: {
    req: Request;
    params: Record<string, string>;
    session: SessionInfo | null;
    resource: TResource;
  }) => Promise<boolean> | boolean;
  requireFlowMessage?: string;

  /**
   * Step 6. Parses and validates the JSON body. Omit for routes with no
   * body (GET, DELETE). A parse failure is a 400 carrying `fieldErrors`
   * keyed by field path (`z.flattenError`).
   */
  bodySchema?: ZodType<TBody>;

  /**
   * Step 7. Returning `false` is a 429. Runs last — after every other
   * check has already decided the request is otherwise well-formed and
   * authorized.
   */
  rateLimit?: (args: {
    req: Request;
    params: Record<string, string>;
    session: SessionInfo | null;
    resource: TResource;
    body: TBody;
  }) => Promise<boolean> | boolean;

  /**
   * Runs only once every check above has passed. Must return a `Response`
   * built with `successResponse`/`errorResponse` (`lib/errors.ts`) — never
   * a bare `NextResponse.json()`, so every route shares the one envelope.
   */
  handler: (args: WithAuthArgs<TResource, TBody>) => Promise<Response>;

  /**
   * Injectable session lookup, for tests only. Defaults to
   * `verifySession` from `lib/auth/dal.ts`. Production code must never
   * pass this.
   */
  getSession?: () => Promise<SessionInfo | null>;
};

type RouteContext = { params: Promise<Record<string, string>> };

/**
 * Same-origin check for non-GET methods (ADR-0006, CSRF mitigation). Prefers
 * `Sec-Fetch-Site` (set by browsers on fetch/XHR/form requests and not
 * spoofable from script) when present, falling back to comparing the
 * `Origin` header's host against the request's own host. A request with
 * neither header is treated as same-origin: this check is defense in depth
 * on top of `SameSite=Lax` session cookies (ADR-0006), not the sole CSRF
 * control, and plenty of legitimate non-browser callers (server-to-server,
 * this very test suite) send neither header.
 */
function isSameOriginRequest(req: Request): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) return secFetchSite === "same-origin" || secFetchSite === "none";

  const origin = req.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * `z.flattenError().fieldErrors` types each key as `string[] | undefined`
 * (a key with no issues is simply absent at runtime, but the generic
 * mapped type can't express that). Filters those out so the result matches
 * `ApiError.fieldErrors: Record<string, string[]>` (`lib/errors.ts`)
 * exactly, with no cast.
 */
function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  // zod's own `_FlattenedError<T>.fieldErrors` type is
  // `{ [P in keyof T]?: string[] }` (node_modules/zod/v4/core/errors.d.ts).
  // Called here with a plain `z.ZodError` (this function serves every
  // route's `bodySchema`, whatever its output type), that mapped type
  // resolves to a shape TypeScript can no longer type `Object.entries`
  // over as `[string, string[] | undefined][]`. The runtime value is
  // always a plain string-keyed object mapping to `string[]`, per zod's
  // own implementation — this cast documents that fact rather than hiding
  // an `any`.
  const fieldErrors = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value) result[key] = value;
  }
  return result;
}

const NO_BODY_METHODS = new Set(["GET", "HEAD"]);

export function withAuth<TResource = undefined, TBody = undefined>(
  config: WithAuthConfig<TResource, TBody>,
) {
  return async (req: Request, ctx: RouteContext): Promise<Response> => {
    const params = await ctx.params;
    const mode = config.mode ?? "session";
    const getSession = config.getSession ?? verifySession;

    // Step 1 — session present.
    let session: SessionInfo | null = null;
    if (mode === "session") {
      session = await getSession();
      if (!session) return errorResponse(apiErr("UNAUTHENTICATED"));
    } else {
      session = await getSession().catch(() => null);
    }

    // Step 2 — same-origin check, non-GET only.
    if (!NO_BODY_METHODS.has(req.method) && !isSameOriginRequest(req)) {
      return errorResponse(apiErr("FORBIDDEN"));
    }

    // Step 3 — resource resolution (owner-scoped; 404 hides cross-account existence).
    let resource: TResource | undefined;
    if (config.resolveResource) {
      const resolved = await config.resolveResource({ req, params, session });
      if (resolved === null || resolved === undefined) {
        return errorResponse(apiErr("NOT_FOUND"));
      }
      resource = resolved;
    }

    // Step 4 — the consent-state gate. MUST run before step 6 (body parsing).
    if (config.requireState && resource !== undefined) {
      if (!config.requireState(resource)) {
        return errorResponse(
          apiErr("FORBIDDEN", config.requireStateMessage ? { message: config.requireStateMessage } : undefined),
        );
      }
    }

    // Step 5 — flow-order precondition.
    if (config.requireFlow && resource !== undefined) {
      const ok = await config.requireFlow({ req, params, session, resource });
      if (!ok) {
        return errorResponse(
          apiErr("CONFLICT", config.requireFlowMessage ? { message: config.requireFlowMessage } : undefined),
        );
      }
    }

    // Step 6 — zod parse of the body.
    let body: TBody = undefined as TBody;
    if (config.bodySchema) {
      let json: unknown;
      try {
        json = await req.json();
      } catch {
        json = undefined;
      }
      const parsed = config.bodySchema.safeParse(json);
      if (!parsed.success) {
        return errorResponse(
          apiErr("VALIDATION_ERROR", { fieldErrors: toFieldErrors(parsed.error) }),
        );
      }
      body = parsed.data;
    }

    // Step 7 — rate limit, last.
    if (config.rateLimit) {
      const allowed = await config.rateLimit({
        req,
        params,
        session,
        resource: resource as TResource,
        body,
      });
      if (!allowed) return errorResponse(apiErr("RATE_LIMITED"));
    }

    try {
      return await config.handler({ req, params, session, resource: resource as TResource, body });
    } catch (err) {
      // M1 AC 24: never leak an exception message, stack trace or provider
      // payload into a response body.
      console.error("Unhandled route handler error", err);
      return errorResponse(apiErr("INTERNAL_ERROR"));
    }
  };
}

export type { ApiResult };
