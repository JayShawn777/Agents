import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { VOICE_CONSENT_WORDING_VERSION } from "@/lib/voice/consent-copy";
import { isAcceptedVoiceContentType } from "@/lib/voice/naming";
import {
  VOICE_ATTEMPTS_PER_WINDOW,
  VOICE_ATTEMPT_WINDOW_MS,
  VOICE_SAMPLE_MAX_MS,
  VOICE_SAMPLE_MIN_MS,
} from "@/lib/config";

/**
 * M6 AC 9/11 — issuing a grant to upload the voice SAMPLE, the bytes a clone is
 * actually made from.
 *
 * ## Why this is a separate module from `consent.ts`
 *
 * The two grants look alike and are not alike. A consent recording is evidence
 * we keep; a sample is the most sensitive object this application will ever hold
 * and is deleted the moment the clone exists (`VOICE_SAMPLE_RETENTION_DAYS` is
 * 0). Sharing one function would mean one set of duration bounds, one retention
 * story and one deletion path for two things that need different ones.
 *
 * ## The ordering AC 5 requires is enforced HERE, not merely in the UI
 *
 * A sample grant cannot be issued without a usable consent recording. That is
 * AC 6 moved off the creation endpoint and onto the step that first writes
 * bytes: refusing at creation would mean we had already accepted, stored and
 * retained a voice sample from someone who never recorded a consent statement.
 * The gate belongs where the sensitive object is created, not where it is used.
 *
 * ## The pathname is chosen here and never accepted
 *
 * Identical reasoning to `consent.ts`: the client asks for a grant and is told
 * where to upload. There is no field in which to name someone else's object.
 * See the plan's §3.1 for what this does and does not prove — it refuses the
 * attack AC 4 describes, and it cannot prove the bytes came from a microphone.
 */

/** Mirrors `voiceConsentPathname`. A distinct prefix so retention can target it. */
export function voiceSamplePathname(userId: string, extension: string): string {
  return `users/${userId}/voice-sample/${randomUUID()}.${extension}`;
}

export type IssueSampleGrantResult =
  | { ok: true; grantId: string; pathname: string; consentRecordingId: string }
  | {
      ok: false;
      code: "UNSUPPORTED_TYPE" | "RATE_LIMITED" | "DURATION_OUT_OF_BOUNDS" | "NO_USABLE_CONSENT";
    };

/**
 * Issues a single-use grant for the voice sample.
 *
 * **Duration is checked before anything else**, for the same reason
 * `confirmConsentRecording` checks it first: it needs no I/O, and a rejection
 * here does not burn a grant or count against the rate limit for a recording the
 * browser should have refused to submit (AC 9).
 *
 * **The consent recording is re-verified server-side even though the client
 * names it.** The id arrives in the body, so it is attacker-controlled; it is
 * matched against this user's own recordings at the CURRENT wording version and
 * not already spent on a voice. A recording belonging to another account is
 * indistinguishable from one that does not exist.
 */
export async function issueSampleGrant(args: {
  userId: string;
  contentType: string;
  extension: string;
  durationMs: number;
  consentRecordingId: string;
}): Promise<IssueSampleGrantResult> {
  if (args.durationMs < VOICE_SAMPLE_MIN_MS || args.durationMs > VOICE_SAMPLE_MAX_MS) {
    return { ok: false, code: "DURATION_OUT_OF_BOUNDS" };
  }

  if (!isAcceptedVoiceContentType(args.contentType)) {
    return { ok: false, code: "UNSUPPORTED_TYPE" };
  }

  // AC 6/AC 5's ordering. Scoped to the caller, to the current wording, and to
  // a recording no voice has already consumed — the same three conditions
  // `findUsableConsentRecording` applies, asserted against the NAMED recording
  // so the client cannot have one recording authorise two samples.
  const recording = await db.voiceConsentRecording.findFirst({
    where: {
      id: args.consentRecordingId,
      userId: args.userId,
      consentWordingVersion: VOICE_CONSENT_WORDING_VERSION,
      customVoice: { is: null },
    },
    select: { id: true },
  });
  if (!recording) return { ok: false, code: "NO_USABLE_CONSENT" };

  // AC 15's rate limit counts BOTH purposes, deliberately: the limit exists to
  // bound how often an account can push audio at our store, and splitting the
  // budget per purpose would double it.
  const windowStart = new Date(Date.now() - VOICE_ATTEMPT_WINDOW_MS);
  const recent = await db.voiceUploadGrant.count({
    where: { userId: args.userId, createdAt: { gte: windowStart } },
  });
  if (recent >= VOICE_ATTEMPTS_PER_WINDOW) {
    return { ok: false, code: "RATE_LIMITED" };
  }

  const grant = await db.voiceUploadGrant.create({
    data: {
      userId: args.userId,
      purpose: "VOICE_SAMPLE",
      pathname: voiceSamplePathname(args.userId, args.extension),
      contentType: args.contentType,
    },
  });

  return { ok: true, grantId: grant.id, pathname: grant.pathname, consentRecordingId: recording.id };
}

export type VoiceUploadAuthorization =
  | { ok: true; pathname: string; contentType: string }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_USED" | "PATHNAME_MISMATCH" };

/**
 * M6 AC 4/AC 11. Authorizes ONE client-token request against a grant, for
 * `POST /api/blob/upload`.
 *
 * This is the point where "the client cannot name the object" stops being a
 * property of the issuing endpoint and becomes enforced on the upload itself.
 * M1's equivalent asserts the requested pathname against a per-student
 * *pattern*, because a worksheet's final key gets a random suffix. A voice
 * grant is stricter: the pathname must equal the grant's own, exactly. There is
 * one legal key per grant and we already know what it is.
 *
 * **A consumed grant is refused.** The grant is not marked consumed here — that
 * happens at confirm (consent) or creation (sample), once the bytes are known to
 * have landed. Refusing an already-consumed grant stops a spent grant being
 * replayed to overwrite an object we have already treated as evidence.
 *
 * Scoped to the caller, so another account's grant is indistinguishable from a
 * nonexistent one.
 */
export async function authorizeVoiceUpload(args: {
  userId: string;
  grantId: string;
  pathname: string;
}): Promise<VoiceUploadAuthorization> {
  const grant = await db.voiceUploadGrant.findFirst({
    where: { id: args.grantId, userId: args.userId },
    select: { pathname: true, contentType: true, consumedAt: true },
  });
  if (!grant) return { ok: false, code: "NOT_FOUND" };
  if (grant.consumedAt) return { ok: false, code: "ALREADY_USED" };
  if (grant.pathname !== args.pathname) return { ok: false, code: "PATHNAME_MISMATCH" };
  return { ok: true, pathname: grant.pathname, contentType: grant.contentType };
}
