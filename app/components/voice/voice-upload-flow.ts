/**
 * M6 AC 11 — the browser half of the voice upload, for both the consent
 * statement and the sample.
 *
 * Deliberately a near-mirror of `components/uploads/upload-flow.ts` rather than
 * a shared abstraction: the two flows agree on the transport and disagree on
 * everything else — what authorizes them (a student profile vs a single-use
 * grant), what they may send (images and PDFs vs audio), and what happens next
 * (extraction vs a consent record). Folding them together would put a
 * `if (isVoice)` inside every step of a security-relevant path. See that file's
 * docstring for why neither calls `upload()` directly.
 *
 * **This module never chooses a pathname.** The server issued one with the
 * grant; the client's only job is to send bytes to it. That is what makes AC 4
 * enforceable, and it is the one difference from the worksheet flow that must
 * never be "simplified" into symmetry.
 */

import { put } from "@vercel/blob/client";

const LOCAL_TOKEN_PREFIX = "local-inert-token:";

const GENERIC_RETRY_MESSAGE = "The recording didn't upload. Please try again.";
const NETWORK_MESSAGE = "A network problem stopped the upload. Please check your connection and try again.";

export type VoiceUploadOutcome = { ok: true } | { ok: false; message: string };

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

type TokenResult = { ok: true; clientToken: string; isLocal: boolean } | { ok: false; message: string };

async function requestClientToken(pathname: string, voiceGrantId: string): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetch("/api/blob/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          // The SERVER's pathname, echoed back unchanged. `authorizeVoiceUpload`
          // refuses anything else, so altering it here fails closed.
          pathname,
          multipart: false,
          clientPayload: JSON.stringify({ voiceGrantId }),
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

/** `STORAGE_DRIVER=local` has no CDN to PUT against. See the worksheet flow. */
async function uploadViaLocalDev(blob: Blob, pathname: string, voiceGrantId: string): Promise<VoiceUploadOutcome> {
  const form = new FormData();
  // A generic name: a parent's own filename is not ours to send anywhere, and
  // the server ignores it regardless.
  form.append("file", new File([blob], "recording", { type: blob.type }));
  form.append("voiceGrantId", voiceGrantId);
  form.append("pathname", pathname);

  let response: Response;
  try {
    response = await fetch("/api/dev/local-upload", { method: "POST", body: form });
  } catch {
    return { ok: false, message: NETWORK_MESSAGE };
  }
  if (!response.ok) {
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, message: extractApiErrorMessage(json) ?? GENERIC_RETRY_MESSAGE };
  }
  return { ok: true };
}

/**
 * Sends one recording to the store. `pathname` and `grantId` both come from the
 * server that issued the grant — neither is constructed here.
 */
export async function uploadVoiceRecording(args: {
  blob: Blob;
  pathname: string;
  grantId: string;
}): Promise<VoiceUploadOutcome> {
  const token = await requestClientToken(args.pathname, args.grantId);
  if (!token.ok) return token;

  if (token.isLocal) {
    return uploadViaLocalDev(args.blob, args.pathname, args.grantId);
  }

  try {
    await put(args.pathname, args.blob, {
      access: "public",
      token: token.clientToken,
      contentType: args.blob.type,
      // The store is private (ADR-0003); `access` above is the SDK's required
      // literal, not a visibility choice — the token decides where this lands.
      multipart: false,
    });
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_RETRY_MESSAGE };
  }
}
