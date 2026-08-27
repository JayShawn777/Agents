import "server-only";

import type { ZodType } from "zod";

import { apiErr, errorResponse, toFieldErrors, type ApiResult } from "@/lib/errors";
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
 *      (its message may be a function of the resource — see
 *      `requireFlowMessage`, added 2026-08-27 for M2.5)
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
 *
 * `withAuth()` itself throws synchronously if `requireState` or
 * `requireFlow` is configured without `resolveResource` — see the check at
 * the top of the function body for why silently skipping the gate is the
 * alternative if this is missing.
 *
 * **Step 2b — `publicRateLimit`, public mode only, runs BEFORE step 3.**
 * A finding from the M0 consent-flow review: for a `mode: "public"` route
 * whose "resource" IS the caller's credential (`/api/consent/verify`,
 * `/api/consent/decline`, `/api/consent/callback/[method]` — a
 * single-use, session-free consent-challenge token, which for `EMAIL_PLUS`
 * *is* parental consent, ADR-0008 §4), an unknown or wrong token resolves
 * to nothing at step 3 and exits as a 404 *before ever reaching step 7's
 * `rateLimit`*. That makes the ordinary `rateLimit` hook unreachable by the
 * exact request an attacker sends when brute-forcing the token space: every
 * guess is a free, unthrottled 404. `publicRateLimit` closes this by running
 * immediately after the same-origin check and before ANY lookup keyed on
 * attacker-controlled input — keyed on the caller's IP rather than on a
 * resource that may not exist. Throws at the boot if configured without
 * `mode: "public"` (a session-mode route's step 1 already stops an
 * unauthenticated caller before resource resolution, so this hook has
 * nothing to add there — see the check at the top of the function body).
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
   * Step 2b. PUBLIC MODE ONLY — see the docstring above. Runs after the
   * same-origin check and BEFORE `resolveResource` (step 3), so a route
   * whose resource resolution is itself the sensitive lookup (a consent
   * challenge token) cannot let a wrong guess skip rate limiting entirely.
   * Returning `false` is a 429. Has no access to `resource` or `body` —
   * both are unresolved at this point — only `req`/`params`, which is
   * enough to key a limiter off the caller's IP.
   */
  publicRateLimit?: (args: {
    req: Request;
    params: Record<string, string>;
  }) => Promise<boolean> | boolean;

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
  /**
   * Overrides the default CONFLICT message. Must still be an allowlisted,
   * user-safe string (`lib/errors.ts`) — that has not changed.
   *
   * A FUNCTION of the resource, as well as a plain string, because one gate
   * routinely guards several unrelated preconditions and a single static
   * string then has to serve all of them. The attempts route already carries
   * that compromise in a comment: "You've given this one a good go" is written
   * for the attempt cap and is merely tolerable for a set that is still
   * generating. M2.5 makes it untenable rather than untidy — a checkpoint
   * takes exactly one answer per problem (AC 11), and telling a child they
   * have had plenty of tries when they have had one is worse than unhelpful.
   *
   * The function receives the resource ONLY — not the body, which has not been
   * parsed at step 5, and not the session. It must be synchronous and must not
   * reach the database: it runs on the failure path of a check that has
   * already decided, and a message is not worth a query.
   */
  requireFlowMessage?: string | ((resource: TResource) => string);

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
export function isSameOriginRequest(req: Request): boolean {
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

const NO_BODY_METHODS = new Set(["GET", "HEAD"]);

export function withAuth<TResource = undefined, TBody = undefined>(
  config: WithAuthConfig<TResource, TBody>,
) {
  // Fail the BOOT, not the request. `requireState`/`requireFlow` (steps 4/5)
  // are only ever consulted when `resolveResource` (step 3) actually ran and
  // resolved something — see the `resource !== undefined` guards below. A
  // route that configures one of these gates without `resolveResource` would
  // have `resource` permanently `undefined`, so the guard would short-circuit
  // and the gate would be skipped on every request, silently. That is
  // unreachable today, but becomes reachable the moment a route resolves its
  // subject from the request body rather than the URL (e.g. a consent-submit
  // or upload-token endpoint) instead of a path param. Throwing here — at
  // module load, when the route file's `export const POST = withAuth({...})`
  // runs — means a misconfigured route fails to build/boot instead of
  // serving every request with its consent gate disabled.
  if ((config.requireState || config.requireFlow) && !config.resolveResource) {
    throw new Error(
      "withAuth(): `requireState`/`requireFlow` configured without `resolveResource`. " +
        "Both gates only run when a resource has been resolved (ADR-0006 steps 3-5); " +
        "without `resolveResource` they would silently never execute. Add `resolveResource`.",
    );
  }

  // `publicRateLimit` (step 2b) exists specifically to run ahead of a
  // public route's resource resolution — a session-mode route's step 1
  // already rejects an unauthenticated caller before step 3 runs, so this
  // hook has nothing to add there. Configuring it without `mode: "public"`
  // is very likely someone reaching for `rateLimit` (step 7) and finding
  // this one instead; fail loudly rather than silently no-op.
  if (config.publicRateLimit && config.mode !== "public") {
    throw new Error(
      "withAuth(): `publicRateLimit` is configured but `mode` is not \"public\". " +
        "This hook exists to close the public-mode reachability gap where a wrong " +
        "token/credential 404s at resource resolution before step 7's `rateLimit` " +
        "ever runs. Set `mode: \"public\"`, or use `rateLimit` instead.",
    );
  }

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

    // Step 2b — public-mode pre-resolution rate limit. MUST run before step 3:
    // see the docstring above and `publicRateLimit`'s own doc comment.
    if (mode === "public" && config.publicRateLimit) {
      const allowed = await config.publicRateLimit({ req, params });
      if (!allowed) return errorResponse(apiErr("RATE_LIMITED"));
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
        const configured = config.requireFlowMessage;
        const message = typeof configured === "function" ? configured(resource) : configured;
        return errorResponse(apiErr("CONFLICT", message ? { message } : undefined));
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
        const { fieldErrors, formErrors } = toFieldErrors(parsed.error);
        return errorResponse(apiErr("VALIDATION_ERROR", { fieldErrors, formErrors }));
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
