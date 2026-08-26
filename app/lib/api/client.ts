/**
 * `apiFetch<T>()` (plan §5.2, F2).
 *
 * The ONLY place in the frontend where an `ApiError` is unwrapped. Every
 * component that calls this receives an already-narrowed `ApiResult<T>` and
 * switches on `result.ok` — no component parses a `Response`, inspects a
 * status code, or reads a raw error message itself.
 *
 * Every route handler in the API contract (plan §3.2) returns
 * `Cache-Control: no-store` and a JSON body shaped `ApiResult<T>` on every
 * status code, success or failure (plan §2). `apiFetch` trusts that shape
 * for any response that parses as JSON. A response that doesn't fit — a
 * network failure, a proxy error page, an unexpected non-JSON body — is
 * turned into the same `ApiResult<never>` shape client code already knows
 * how to render, rather than being allowed to throw across a component
 * boundary (M1 AC 24: nothing but an allowlisted message ever surfaces).
 *
 * Intended for CLIENT components calling a route handler (endpoints 2-28 in
 * plan §3.2, e.g. a delete confirmation, an upload action). It is not used
 * to reach the two server actions (`signInWithEmail`, `signOutSession`,
 * plan §3.1) — those are invoked directly as React Server Functions, which
 * already return `ApiResult<T>` with no HTTP round trip to unwrap. Server
 * Components should call the DAL directly rather than fetch their own
 * route handlers.
 */

import { apiErrResult, type ApiResult } from "@/lib/errors";

export type ApiFetchInit = Omit<RequestInit, "body"> & {
  /**
   * A plain-object body is JSON-serialized and given the right
   * `Content-Type` automatically. Pass a `FormData`/`Blob`/string/etc. via
   * `body` unchanged (e.g. a multipart upload) — only a plain object gets
   * encoded here.
   */
  body?: BodyInit | Record<string, unknown> | null;
};

function isPlainObjectBody(
  body: ApiFetchInit["body"],
): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    !ArrayBuffer.isView(body)
  );
}

function isApiResultShape(value: unknown): value is { ok: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean"
  );
}

/**
 * Calls `input` and resolves an already-narrowed `ApiResult<T>`. Never
 * throws for an HTTP error status or a network failure.
 *
 * `T` must match the `data` type the endpoint's contract entry in plan
 * §3.2 documents — pick it from `lib/schemas/dto.ts` (or the endpoint's
 * documented response envelope) and nowhere else. This function cannot
 * verify the response shape beyond `{ ok: boolean }`; it is not a
 * substitute for the server-side zod validation the contract already
 * performs.
 */
export async function apiFetch<T>(
  input: string | URL,
  init?: ApiFetchInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const { body, headers, ...rest } = init ?? {};
    const isPlainObject = isPlainObjectBody(body);
    response = await fetch(input, {
      ...rest,
      headers: isPlainObject
        ? { "Content-Type": "application/json", ...headers }
        : headers,
      body: isPlainObject ? JSON.stringify(body) : (body ?? undefined),
    });
  } catch {
    // Network failure, offline, CORS, DNS — never a code path the caller
    // needs to distinguish from an upstream 502.
    return apiErrResult("UPSTREAM_ERROR");
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // Not JSON at all — a proxy error page, an empty body, etc. Every real
    // endpoint in the contract always returns an ApiResult body, so this
    // means something between the browser and the app misbehaved rather
    // than that the request was rejected in the ordinary way.
    return apiErrResult(response.ok ? "INTERNAL_ERROR" : "UPSTREAM_ERROR");
  }

  if (isApiResultShape(parsed)) {
    return parsed as ApiResult<T>;
  }

  // Parsed JSON that isn't the contract's envelope shape. Treat it the
  // same as a malformed response rather than guessing at a shape.
  return apiErrResult("INTERNAL_ERROR");
}
