/**
 * The client-direct upload network protocol (plan §4/§5.2, F15; ADR-0003;
 * M1 AC 2, 8, 9). Not a React component — plain browser-only orchestration
 * that `upload-panel.tsx` calls, kept out of that file so the component
 * itself stays about state and layout.
 *
 * ## Why this doesn't just call `upload()` from `@vercel/blob/client`
 *
 * `upload()` bundles the token request AND the byte transfer into one call.
 * That's the right shape once a real Vercel Blob store exists, but
 * `STORAGE_DRIVER` currently defaults to `"local"` (`lib/config.ts`) —
 * filesystem-backed, with no CDN for a browser to PUT bytes against
 * (`lib/storage/local-fs.ts`). Calling `upload()` unconditionally would
 * work in production and fail in every local dev environment.
 *
 * The fix is NOT to branch on an environment variable — `lib/config.ts`'s
 * `STORAGE_DRIVER` deliberately resolves to `"local"` for any code running
 * in the browser (see its `typeof window !== "undefined"` guard) precisely
 * so client code can never make a decision based on which storage driver
 * the server is configured with. Instead, this module requests the client
 * token itself (replicating the exact `blob.generate-client-token` wire
 * shape `@vercel/blob`'s `handleUpload()` expects — see
 * `node_modules/@vercel/blob/dist/client.d.ts`'s `GenerateClientTokenEvent`,
 * and `app/api/blob/upload/route.ts`, now landed, which documents the same
 * envelope) and inspects the RESPONSE: `lib/storage/local-fs.ts`'s
 * `handleClientUpload` returns an inert token prefixed
 * `"local-inert-token:"` — a signal already baked into the shared storage
 * adapter, not something invented here — while a real `@vercel/blob` store
 * returns an opaque signed token with no such prefix. That prefix is the
 * one thing about the driver that is safe for client code to branch on.
 *
 * ## The local-dev ingest endpoint
 *
 * `app/api/dev/local-upload/route.ts` (backend track, now landed) is the
 * admission of the gap `lib/storage/local-fs.ts` documents: no `StoragePort`
 * method can carry file bytes, so local dev needs a route that isn't part
 * of the production protocol at all. Its real, built contract —
 * `POST /api/dev/local-upload`, `multipart/form-data` with `file`,
 * `studentProfileId` and `pathname` fields, standard `ApiResult` envelope
 * back — is what `uploadViaLocalDev` below calls. It 404s outright unless
 * `STORAGE_DRIVER === "local"` server-side, so this branch is inert in any
 * deployment where the token response never carries the local-token prefix.
 */

import { put } from "@vercel/blob/client";

import { apiFetch } from "@/lib/api/client";
import type { UploadDTO } from "@/lib/schemas/dto";

/**
 * `POST /api/uploads/confirm`'s success body (plan §3, endpoint 15).
 * `lib/schemas/dto.ts` is off-limits to extend for this task and this
 * exact envelope (`{ upload, extractionId }`) isn't one of its already-named
 * response types (compare `UploadDetailResponse`, which pairs `upload` with
 * a full `extraction`, not a bare id) — so it's declared once, here, next to
 * its one caller, rather than redeclared inline at the call site.
 */
export type ConfirmUploadResponse = { upload: UploadDTO; extractionId: string };

export type UploadProgress = { loaded: number; total: number; percentage: number };

export type UploadOutcome =
  | { ok: true; response: ConfirmUploadResponse }
  | { ok: false; message: string };

const LOCAL_TOKEN_PREFIX = "local-inert-token:";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const GENERIC_RETRY_MESSAGE = "The upload didn't go through. Please try again.";
const NETWORK_MESSAGE = "A network problem stopped the upload. Please check your connection and try again.";

function extensionFor(contentType: string): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
}

/**
 * Builds a fresh, random pathname on every call (never reused across
 * attempts). `addRandomSuffix: true` (the storage policy, ADR-0003) is the
 * server-enforced version of this same guarantee; randomizing here too is
 * what makes a retry after a mid-transfer failure never collide with the
 * partial previous attempt (M1 AC 9), independent of which driver is
 * active.
 */
function proposePathname(studentProfileId: string, contentType: string): string {
  return `students/${studentProfileId}/uploads/${crypto.randomUUID()}.${extensionFor(contentType)}`;
}

/**
 * `ApiResult<never>`'s error message, if `json` parses as that shape.
 * Shared by both branches below since both the token endpoint and the
 * local-dev ingest endpoint report their errors through the same envelope.
 */
function extractApiErrorMessage(json: unknown): string | null {
  if (
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof (json as { error?: unknown }).error === "object" &&
    (json as { error: { message?: unknown } }).error !== null &&
    typeof (json as { error: { message?: unknown } }).error.message === "string"
  ) {
    return (json as { error: { message: string } }).error.message;
  }
  return null;
}

type TokenResult =
  | { ok: true; clientToken: string; isLocal: boolean }
  | { ok: false; message: string };

async function requestClientToken(params: {
  pathname: string;
  clientPayload: string;
  multipart: boolean;
}): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetch("/api/blob/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          pathname: params.pathname,
          multipart: params.multipart,
          clientPayload: params.clientPayload,
        },
      }),
    });
  } catch {
    return { ok: false, message: NETWORK_MESSAGE };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, message: GENERIC_RETRY_MESSAGE };
  }

  if (!response.ok) {
    // Errors from this endpoint (401/403/429 — session, ownership, ACTIVE
    // status, hourly cap) follow the app's normal ApiResult envelope, even
    // though a SUCCESS from this one endpoint is the storage provider's raw
    // token JSON (plan §3, endpoint 14) — apiFetch's `isApiResultShape`
    // check would otherwise misread that raw success body as malformed.
    return { ok: false, message: extractApiErrorMessage(json) ?? GENERIC_RETRY_MESSAGE };
  }

  const parsed = json as { type?: unknown; clientToken?: unknown };
  if (parsed.type !== "blob.generate-client-token" || typeof parsed.clientToken !== "string") {
    return { ok: false, message: GENERIC_RETRY_MESSAGE };
  }

  return {
    ok: true,
    clientToken: parsed.clientToken,
    isLocal: parsed.clientToken.startsWith(LOCAL_TOKEN_PREFIX),
  };
}

/**
 * `POST /api/dev/local-upload` (backend track, landed): `multipart/form-data`
 * with `file`, `studentProfileId` and `pathname` fields, standard
 * `ApiResult<{ pathname, contentType, sizeBytes }>` back. `XMLHttpRequest`
 * rather than `fetch` — the only web-standard way to get real upload
 * progress events for a request body, matching `onUploadProgress`'s shape
 * from the production `put()` branch below (M1 AC 8).
 */
function uploadViaLocalDev(
  pathname: string,
  file: File,
  studentProfileId: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("studentProfileId", studentProfileId);
    form.append("pathname", pathname);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/dev/local-upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // handled by the status check below
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({ loaded: file.size, total: file.size, percentage: 100 });
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, message: extractApiErrorMessage(json) ?? GENERIC_RETRY_MESSAGE });
    };
    xhr.onerror = () => resolve({ ok: false, message: NETWORK_MESSAGE });
    xhr.send(form);
  });
}

/**
 * Runs the full client-direct upload for one file: request a token, move
 * bytes (via the real store or the local-dev route, decided by the token
 * response), then confirm with the server (endpoint 15). `onProgress` is
 * called with real transfer progress in both branches (M1 AC 8).
 */
export async function uploadFile(
  file: File,
  opts: {
    studentProfileId: string;
    originalFilename: string;
    onProgress: (progress: UploadProgress) => void;
  },
): Promise<UploadOutcome> {
  const contentType = file.type;
  const pathname = proposePathname(opts.studentProfileId, contentType);
  const clientPayload = JSON.stringify({
    studentProfileId: opts.studentProfileId,
    originalFilename: opts.originalFilename,
  });

  const tokenResult = await requestClientToken({ pathname, clientPayload, multipart: true });
  if (!tokenResult.ok) return { ok: false, message: tokenResult.message };

  let finalPathname: string;
  if (tokenResult.isLocal) {
    const localResult = await uploadViaLocalDev(pathname, file, opts.studentProfileId, opts.onProgress);
    if (!localResult.ok) return { ok: false, message: localResult.message };
    finalPathname = pathname;
  } else {
    try {
      const result = await put(pathname, file, {
        access: "private",
        token: tokenResult.clientToken,
        contentType,
        multipart: true,
        onUploadProgress: opts.onProgress,
      });
      finalPathname = result.pathname;
    } catch {
      return { ok: false, message: GENERIC_RETRY_MESSAGE };
    }
  }

  const confirmResult = await apiFetch<ConfirmUploadResponse>("/api/uploads/confirm", {
    method: "POST",
    body: {
      studentProfileId: opts.studentProfileId,
      pathname: finalPathname,
      originalFilename: opts.originalFilename,
    },
  });
  if (!confirmResult.ok) return { ok: false, message: confirmResult.error.message };
  return { ok: true, response: confirmResult.data };
}
