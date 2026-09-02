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

import { z } from "zod";

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
  /**
   * Present only for VALIDATION_ERROR, and only when zod attached
   * form-level (not field-level) issues — `z.flattenError().formErrors`.
   * This is where a `.strict()` schema's "unrecognized key" violation
   * lands: a body carrying a key the schema doesn't declare (e.g. a
   * child's name submitted alongside the age-gate's `ageBand`, AC 8/AC 9)
   * produces an EMPTY `fieldErrors` and a non-empty `formErrors`. A caller
   * that reads only `fieldErrors` sees `{}` and no explanation at all.
   */
  formErrors?: string[];
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

/**
 * M2 practice-generation failure codes (plan §2). `PracticeSet.failureCode`
 * is never returned verbatim — `GENERATION_FAILURE_MESSAGES` is the same
 * allowlist pattern as `EXTRACTION_FAILURE_MESSAGES` above (M2 AC 6).
 *
 * `SLATE_EMPTY` is M2-specific: ADR-0009 §4 says an ungradable subject (no
 * Common Core coverage, e.g. SCIENCE with no overlapping standard, or a
 * grade level outside the bundled K-8 range) must be "refused cleanly rather
 * than graded badly" — this is that refusal, reached with zero AI calls,
 * through the SAME terminal-FAILED status machine as every other generation
 * failure (`lib/practice/generate.ts`), so the client has one state to
 * handle rather than a second error shape for this one case.
 */
export const GENERATION_FAILURE_CODES = [
  "REFUSED",
  "PARSE_FAILED",
  "TIMEOUT",
  "UPSTREAM",
  "INTERNAL",
  "SLATE_EMPTY",
] as const;

export type GenerationFailureCode = (typeof GENERATION_FAILURE_CODES)[number];

export const GENERATION_FAILURE_MESSAGES: Record<GenerationFailureCode, string> = {
  REFUSED: "We weren't able to generate practice from this worksheet. Please try again.",
  PARSE_FAILED: "We had trouble creating practice problems this time. Please try again.",
  TIMEOUT: "This is taking longer than expected. Please try again.",
  UPSTREAM: "A service we depend on is temporarily unavailable. Please try again shortly.",
  INTERNAL: "Something went wrong on our end. Please try again.",
  SLATE_EMPTY: "We can't generate practice for this subject or grade level yet.",
};

/**
 * ADR-0011 §4. Substituted for a model-generated hint that a post-check
 * (`lib/grading/adjudicate.ts`) finds contains the canonical answer or any
 * accepted form, verbatim or in normalised form. Deliberately generic —
 * a fallback a child might read after a genuinely bad hint should encourage
 * another try, not repeat itself into its own kind of unhelpfulness. The
 * SAME fallback backs M3's chat replies (ADR-0011 §4).
 */
export const HINT_FALLBACK = "Try looking at the problem one more time and see what you notice.";

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
  overrides?: { message?: string; fieldErrors?: Record<string, string[]>; formErrors?: string[] },
): ApiError {
  return {
    code,
    message: overrides?.message ?? ERROR_MESSAGES[code],
    ...(overrides?.fieldErrors !== undefined ? { fieldErrors: overrides.fieldErrors } : {}),
    ...(overrides?.formErrors !== undefined && overrides.formErrors.length > 0
      ? { formErrors: overrides.formErrors }
      : {}),
  };
}

export function apiErrResult(
  code: ErrorCode,
  overrides?: { message?: string; fieldErrors?: Record<string, string[]>; formErrors?: string[] },
): ApiResult<never> {
  return { ok: false, error: apiErr(code, overrides) };
}

// ─────────────────────────── zod error mapping ───────────────────────────

/**
 * Maps a zod validation failure to the `{ fieldErrors, formErrors }` shape
 * `ApiError` carries. The ONE place this mapping happens — `lib/api/handler.ts`
 * (every route handler's body parse) and `lib/auth/actions.ts` (the two
 * server actions, ADR-0006) both call this rather than each re-deriving it
 * from `z.flattenError()` — a prior version reimplemented this inline in
 * both places and only one of them read `formErrors`.
 *
 * `z.flattenError().fieldErrors` types each key as `string[] | undefined`
 * (a key with no issues is simply absent at runtime, but the generic mapped
 * type can't express that). Filtered below so the result matches
 * `ApiError.fieldErrors: Record<string, string[]>` exactly, with no cast
 * needed for the filtered value.
 *
 * `formErrors` is where a `.strict()` schema's "unrecognized key" violation
 * lands — NOT in `fieldErrors` — which is why a caller that reads only
 * `fieldErrors` for a body like `{ ageBand, displayName }` against a
 * `.strict()` age-gate schema sees an empty `{}` and no explanation (the
 * bug this function exists to close).
 */
export function toFieldErrors(error: z.ZodError): {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
} {
  const flattened = z.flattenError(error);
  // zod's own `_FlattenedError<T>.fieldErrors` type is
  // `{ [P in keyof T]?: string[] }` (node_modules/zod/v4/core/errors.d.ts).
  // Called here with a plain `z.ZodError` (this function serves every
  // route's `bodySchema`, whatever its output type), that mapped type
  // resolves to a shape TypeScript can no longer type `Object.entries`
  // over as `[string, string[] | undefined][]`. The runtime value is
  // always a plain string-keyed object mapping to `string[]`, per zod's
  // own implementation — this cast documents that fact rather than hiding
  // an `any`.
  const rawFieldErrors = flattened.fieldErrors as Record<string, string[] | undefined>;
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawFieldErrors)) {
    if (value) fieldErrors[key] = value;
  }
  return { fieldErrors, formErrors: flattened.formErrors };
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

// ─────────────────────────── M3: chat stream failures ───────────────────────────

/**
 * ADR-0013 §5. Internal reasons a chat turn can fail AFTER the stream has
 * opened — the point past which the HTTP status is already 200 and can no
 * longer change, so the failure travels as a terminal `{ type: 'error' }`
 * NDJSON event instead of an `ApiResult` response.
 *
 * These are classified from typed SDK error classes and from `stop_reason`,
 * most specific first, exactly as `lib/extraction/run-extraction.ts` does it.
 * NOTHING in this path string-matches an exception message, and nothing
 * derives a code from one.
 */
export const CHAT_FAILURE_CODES = ["REFUSED", "TIMEOUT", "UPSTREAM", "INTERNAL"] as const;

export type ChatFailureCode = (typeof CHAT_FAILURE_CODES)[number];

/**
 * The allowlist AC 18 is actually about: what a CHILD reads when a turn
 * fails. Every string here is hand-written and user-safe — never an exception
 * message, never a stack trace, never a model identifier, never a provider
 * payload.
 *
 * The wording is deliberately blameless and short. A child who has just typed
 * a question and got an error should not be handed something that reads like
 * they broke it, and should not have to parse a sentence to learn that trying
 * again is the move.
 */
export const CHAT_FAILURE_MESSAGES: Record<ChatFailureCode, { code: ErrorCode; message: string }> = {
  REFUSED: {
    code: "UPSTREAM_ERROR",
    message: "I can't help with that one. Try asking about the problem in a different way.",
  },
  TIMEOUT: {
    code: "UPSTREAM_ERROR",
    message: "That took too long to come back. Please try asking again.",
  },
  UPSTREAM: {
    code: "UPSTREAM_ERROR",
    message: "The tutor isn't available right now. Please try again in a moment.",
  },
  INTERNAL: {
    code: "INTERNAL_ERROR",
    message: "Something went wrong on our end. Please try asking again.",
  },
};


// ─────────────────────────── M4: lesson authoring failures ───────────────────────────

/**
 * `LessonScriptVersion.failureCode` is never returned verbatim — it may name a
 * model, a provider error class or a parse detail. `LessonDTO.failureMessage`
 * is built by looking up this table, the same allowlist pattern as
 * `EXTRACTION_FAILURE_MESSAGES` and `GENERATION_FAILURE_MESSAGES` (M4 AC 10).
 *
 * `INVALID_SCRIPT` is M4-specific and covers both ways a script can be
 * unusable: it failed the zod vocabulary (AC 3) or it referred to an element
 * nobody drew (`lib/lessons/validate.ts`). Both mean the same thing to a
 * child — the drawing would not have made sense — so they share one message.
 */
export const LESSON_FAILURE_CODES = [
  "REFUSED",
  "PARSE_FAILED",
  "INVALID_SCRIPT",
  "TIMEOUT",
  "UPSTREAM",
  "INTERNAL",
] as const;

export type LessonFailureCode = (typeof LESSON_FAILURE_CODES)[number];

export const LESSON_FAILURE_MESSAGES: Record<LessonFailureCode, string> = {
  REFUSED: "We couldn't build a lesson for this one. Try asking for it again.",
  PARSE_FAILED: "We had trouble drawing this lesson. Please try again.",
  INVALID_SCRIPT: "We had trouble drawing this lesson. Please try again.",
  TIMEOUT: "This is taking longer than expected. Please try again.",
  UPSTREAM: "A service we depend on is temporarily unavailable. Please try again shortly.",
  INTERNAL: "Something went wrong on our end. Please try again.",
};

// ─────────────────────────── M5: narration failures ───────────────────────────

/**
 * `LessonNarration.failureCode` is never returned verbatim — the same
 * allowlist pattern as `LESSON_FAILURE_CODES` (M5 AC 10's equivalent). A
 * narration run failing is a SOFTER failure than a lesson authoring failure:
 * AC 17 says the lesson still plays, silently, with captions, so nothing
 * here needs to be alarming.
 *
 * `UNSPEAKABLE` is M5-specific: the source script's narration still carries
 * LaTeX markup a TTS vendor swallows into a fluent, confidently WRONG
 * explanation (`lib/narration/speakable.ts`, measured in
 * `docs/research/m5-narration-measurement.md` Part 2, N3). Reachable in
 * practice only for a lesson authored before `assertSpeakableNarration`
 * existed, or a script written by a bypassing path — a NEW lesson can never
 * produce it, because the authoring guard maps the same underlying condition
 * to `INVALID_SCRIPT` and regenerates before a narration row ever exists.
 */
/**
 * `CONSENT_INACTIVE` (2026-09-02 security review) is what a run aborts with when
 * the profile stops being ACTIVE while it is in flight. `after()` keeps running
 * for the route's whole `maxDuration` (300s), so a withdrawal or a §312.6
 * deletion landing mid-run previously kept calling the vendor and writing blobs
 * derived from that child's schoolwork for up to five more minutes.
 */
export const NARRATION_FAILURE_CODES = [
  "UNSPEAKABLE",
  "TIMEOUT",
  "UPSTREAM",
  "INTERNAL",
  "CONSENT_INACTIVE",
] as const;

export type NarrationFailureCode = (typeof NARRATION_FAILURE_CODES)[number];

export const NARRATION_FAILURE_MESSAGES: Record<NarrationFailureCode, string> = {
  UNSPEAKABLE: "We couldn't add a spoken voice to this lesson. It will still play with captions.",
  TIMEOUT: "Narration is taking longer than expected. This lesson will still play with captions for now.",
  UPSTREAM: "The narration voice isn't available right now. This lesson will still play with captions.",
  INTERNAL: "Something went wrong preparing the narration. This lesson will still play with captions.",
  // Deliberately says nothing about consent state to whoever is looking at the
  // lesson — the account owner already knows they withdrew it, and a child
  // reading this screen is not who that decision needs explaining to.
  CONSENT_INACTIVE: "Narration isn't available for this profile right now. This lesson will still play with captions.",
};
