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

import { apiErrResult, ERROR_MESSAGES, type ApiError, type ApiResult, type ErrorCode } from "@/lib/errors";

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

// ─────────────────────────── the streaming primitive ───────────────────────────

/**
 * A terminal failure, in the SAME shape the NDJSON stream itself uses for one
 * (ADR-0013 §1). `apiStream` synthesises one of these from a pre-stream
 * `ApiResult` failure so a caller has exactly one thing to handle.
 */
export type StreamErrorEvent = { type: "error"; code: ErrorCode; message: string };

/**
 * `apiStream<E>()` (ADR-0013 §6) — the second and only other primitive beside
 * `apiFetch<T>()`, for the one endpoint that streams (`POST /api/chat/sessions/
 * [sessionId]/messages`). It yields parsed NDJSON lines.
 *
 * **DEVIATION from ADR-0013 §6, deliberate.** The ADR says this "throws
 * `ApiError` on a non-2xx". It does not throw. A pre-stream failure is yielded
 * as a terminal `{ type: 'error' }` event instead — which is what ADR-0013 §2
 * asks of the caller in its own words: "the client treats an `error` event
 * exactly as it treats a non-2xx response." Throwing would give this app two
 * ways to report the same failure and would be the only place a network error
 * crosses a component boundary as an exception, which `apiFetch` exists
 * specifically to prevent. One shape, one code path, and a caller that cannot
 * forget a `try`.
 *
 * The generator always terminates. It yields at most one error event and stops.
 */
export async function* apiStream<E>(
  url: string | URL,
  init?: RequestInit,
): AsyncGenerator<E | StreamErrorEvent> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // Includes the AbortController firing on component unmount. There is
    // nothing to report to a component that is being torn down, but a caller
    // that aborted deliberately already knows, and one that lost the network
    // needs to leave its typing state.
    yield streamError("UPSTREAM_ERROR");
    return;
  }

  if (!response.ok || !response.body) {
    yield await preStreamError(response);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // THE BUG THIS EXISTS TO PREVENT (ADR-0013's own accepted trade-off): a
  // `delta` will eventually be split mid-JSON across two network chunks. A
  // naive `chunk.split("\n")` per chunk works on localhost, where a small
  // response usually arrives whole, and fails on a real connection. Everything
  // after the last newline is held back until the next chunk completes it.
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (line.trim().length === 0) continue;
        const parsed = parseLine<E>(line);
        if (!parsed.ok) {
          yield parsed.error;
          return;
        }
        yield parsed.value;
      }
    }

    // A final line with no trailing newline. The server always terminates its
    // lines, so this is defensive rather than expected — but dropping a
    // terminal `done` because a byte went missing would leave the UI stuck in
    // its typing state forever, which is the exact failure AC 19 is about.
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail.length > 0) {
      const parsed = parseLine<E>(tail);
      if (!parsed.ok) {
        yield parsed.error;
        return;
      }
      yield parsed.value;
    }
  } catch {
    yield streamError("UPSTREAM_ERROR");
  } finally {
    // Releasing the lock lets the body be cancelled by the caller's
    // `AbortController` without an unhandled rejection.
    reader.releaseLock();
  }
}

function streamError(code: ErrorCode, message?: string): StreamErrorEvent {
  return { type: "error", code, message: message ?? ERROR_MESSAGES[code] };
}

function parseLine<E>(line: string): { ok: true; value: E } | { ok: false; error: StreamErrorEvent } {
  try {
    return { ok: true, value: JSON.parse(line) as E };
  } catch {
    // A line that is not JSON means something between the app and the browser
    // rewrote the body. Treat it like a malformed response, never like content.
    return { ok: false, error: streamError("INTERNAL_ERROR") };
  }
}

/**
 * A failure BEFORE the stream opened, which per ADR-0013 §2 is always a normal
 * `ApiResult` body with a real status code. Its allowlisted message is reused
 * verbatim — it was written to be read by a child or a parent.
 */
async function preStreamError(response: Response): Promise<StreamErrorEvent> {
  try {
    const parsed: unknown = await response.json();
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "ok" in parsed &&
      (parsed as { ok: unknown }).ok === false &&
      "error" in parsed
    ) {
      const error = (parsed as { error: ApiError }).error;
      return { type: "error", code: error.code, message: error.message };
    }
  } catch {
    // Not JSON — a proxy error page, an empty body. Falls through.
  }
  return streamError(response.status >= 500 ? "UPSTREAM_ERROR" : "INTERNAL_ERROR");
}
