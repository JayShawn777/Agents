/**
 * The one typed error shape for the whole app (plan §2).
 *
 * Every response body — success or failure, route handler or server action —
 * is an `ApiResult<T>`. Nothing else defines its own error type. The client
 * fetch wrapper (`lib/api/client.ts`, frontend track) unwraps exactly this
 * shape and nothing else.
 *
 * The single hard rule: `ApiError.message` is always safe to render to a
 * child or a parent. It is NEVER an exception message, a stack trace, a
 * model identifier, or a raw provider payload (M1 AC 24). The only strings
 * that may ever reach `message` are the ones in the allowlists below.
 */

// ─────────────────────────── error codes ───────────────────────────

export const ERROR_CODES = [
  "UNAUTHENTICATED", // 401
  "FORBIDDEN", // 403
  "NOT_FOUND", // 404
  "VALIDATION_ERROR", // 400
  "CONFLICT", // 409
  "RATE_LIMITED", // 429
  "UPSTREAM_ERROR", // 502
  "INTERNAL_ERROR", // 500
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The single code → HTTP status map. Every route handler derives its status
 * from here — never from a literal number scattered through the codebase.
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

// ─────────────────────────── the result shape ───────────────────────────

export type ApiError = {
  code: ErrorCode;
  /**
   * Always safe to render to a student or a parent. Never an exception
   * message, a model identifier, a stack trace or a provider payload
   * (M1 AC 24). Defaults to `ERROR_MESSAGES[code]`; only override with
   * another allowlisted, hand-written, user-safe string.
   */
  message: string;
  /** Present only for VALIDATION_ERROR. Keys are input field paths. */
  fieldErrors?: Record<string, string[]>;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ─────────────────────────── the message allowlist ───────────────────────────

/**
 * The fixed, user-facing message for every error code. This is the
 * allowlist referenced throughout the plan (§2, §3 rule 3, M1 AC 24): no
 * response body anywhere in the app may carry a string that isn't either one
 * of these defaults or another string from an allowlist like this one
 * (e.g. `EXTRACTION_FAILURE_MESSAGES` below).
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "You need to sign in to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that.",
  VALIDATION_ERROR: "Some of the information provided isn't valid.",
  CONFLICT: "That couldn't be completed right now. Please refresh and try again.",
  RATE_LIMITED: "Too many attempts. Please wait a bit and try again.",
  UPSTREAM_ERROR: "A service we depend on is temporarily unavailable. Please try again shortly.",
  INTERNAL_ERROR: "Something went wrong on our end. Please try again.",
};

/**
 * Internal extraction failure codes (`Extraction.failureCode` in the schema)
 * are never returned verbatim — they may name a model, a provider error
 * class, or a parse failure detail. `ExtractionDTO.failureMessage` (S8) must
 * be built by looking up this table, falling back to
 * `ERROR_MESSAGES.INTERNAL_ERROR` for any code not listed here (M1 AC 24).
 */
export const EXTRACTION_FAILURE_CODES = [
  "REFUSED",
  "PARSE_FAILED",
  "TIMEOUT",
  "UPSTREAM",
  "INTERNAL",
] as const;

export type ExtractionFailureCode = (typeof EXTRACTION_FAILURE_CODES)[number];

export const EXTRACTION_FAILURE_MESSAGES: Record<ExtractionFailureCode, string> = {
  REFUSED: "We weren't able to process this worksheet. Please try a different photo.",
  PARSE_FAILED: "We had trouble reading this worksheet. Please try again or use a clearer photo.",
  TIMEOUT: "This is taking longer than expected. Please try again.",
  UPSTREAM: "A service we depend on is temporarily unavailable. Please try again shortly.",
  INTERNAL: "Something went wrong on our end. Please try again.",
};

// ─────────────────────────── construction helpers ───────────────────────────

export function apiOk<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/**
 * Builds an `ApiError`. `message` defaults to the allowlisted string for
 * `code`; pass `message` only to select another allowlisted string (for
 * example one from `EXTRACTION_FAILURE_MESSAGES`), never a computed or
 * exception-derived string.
 */
export function apiErr(
  code: ErrorCode,
  overrides?: { message?: string; fieldErrors?: Record<string, string[]> },
): ApiError {
  return {
    code,
    message: overrides?.message ?? ERROR_MESSAGES[code],
    ...(overrides?.fieldErrors !== undefined ? { fieldErrors: overrides.fieldErrors } : {}),
  };
}

export function apiErrResult(
  code: ErrorCode,
  overrides?: { message?: string; fieldErrors?: Record<string, string[]> },
): ApiResult<never> {
  return { ok: false, error: apiErr(code, overrides) };
}

// ─────────────────────────── Response helpers ───────────────────────────

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  // All responses carry Cache-Control: no-store (plan §3) — none of this
  // app's data is safe to cache, and a cached error can leak stale state.
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Turns an `ApiError` into a `Response` with the status from `ERROR_STATUS`. */
export function errorResponse(error: ApiError, init?: { headers?: HeadersInit }): Response {
  const body: ApiResult<never> = { ok: false, error };
  return jsonResponse(body, ERROR_STATUS[error.code], init?.headers);
}

/** Turns success data into a `Response` carrying the shared `ApiResult<T>` envelope. */
export function successResponse<T>(
  data: T,
  init?: { status?: number; headers?: HeadersInit },
): Response {
  const body: ApiResult<T> = { ok: true, data };
  return jsonResponse(body, init?.status ?? 200, init?.headers);
}
