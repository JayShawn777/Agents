import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import { VOICE_CONSENT_WORDING_VERSION } from "@/lib/voice/consent-copy";
import { isAcceptedVoiceContentType } from "@/lib/voice/naming";
import { VOICE_CONSENT_MAX_MS, VOICE_CONSENT_MIN_MS, VOICE_ATTEMPTS_PER_WINDOW, VOICE_ATTEMPT_WINDOW_MS } from "@/lib/config";

/**
 * M6 AC 5/6/7/8 — issuing a grant for the spoken consent statement, and turning
 * a completed upload into the durable record.
 *
 * ## Why the pathname is chosen here and never accepted
 *
 * AC 4 requires that no path accepts audio the in-app recorder did not produce.
 * The enforceable half of that is this: the client cannot name the object. It
 * asks for a grant, we mint `users/<userId>/voice-consent/<uuid>.<ext>`, and
 * confirm only ever looks at that grant's own pathname. There is no field in
 * which to name somebody else's object.
 *
 * The half we cannot enforce — that the bytes came from a microphone — is stated
 * plainly in the plan rather than implied to be solved. The control against the
 * threat that matters, a child cloning a classmate, is that no student-facing
 * surface reaches any of this (AC 2/AC 3).
 */

/** A per-user extension. `users/<id>/…` mirrors `students/<id>/…` from M1/M5. */
export function voiceConsentPathname(userId: string, extension: string): string {
  return `users/${userId}/voice-consent/${randomUUID()}.${extension}`;
}

export type IssueConsentGrantResult =
  | { ok: true; grantId: string; pathname: string }
  | { ok: false; code: "UNSUPPORTED_TYPE" | "RATE_LIMITED" };

/**
 * AC 15's rate limit, applied to the RECORDING step rather than only to
 * creation. A cap that only guarded voice creation would leave the upload
 * surface — which writes bytes to our store — unbounded.
 */
export async function issueConsentGrant(args: {
  userId: string;
  contentType: string;
  extension: string;
}): Promise<IssueConsentGrantResult> {
  if (!isAcceptedVoiceContentType(args.contentType)) {
    return { ok: false, code: "UNSUPPORTED_TYPE" };
  }

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
      purpose: "CONSENT_STATEMENT",
      pathname: voiceConsentPathname(args.userId, args.extension),
      contentType: args.contentType,
    },
  });

  return { ok: true, grantId: grant.id, pathname: grant.pathname };
}

export type ConfirmConsentResult =
  | { ok: true; consentRecordingId: string }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_USED" | "NO_OBJECT" | "DURATION_OUT_OF_BOUNDS" };

/**
 * Turns an uploaded object into a `VoiceConsentRecording`.
 *
 * **The grant is claimed with a guarded `updateMany`, not read-then-write.** Two
 * concurrent confirms for one grant would otherwise both pass the "not consumed"
 * check and write two recordings for one recording — the same compare-and-swap
 * discipline `runNarrationGeneration` uses, and the shape M4's review found
 * missing in its own claim path.
 *
 * **The object is verified to exist before the row is written.** A confirm for a
 * grant whose upload never landed must not produce a consent record pointing at
 * nothing: AC 6 refuses voice creation without a recording, and a recording that
 * references no audio would satisfy that check while evidencing nothing.
 */
export async function confirmConsentRecording(
  storage: StoragePort,
  args: { userId: string; grantId: string; durationMs: number; ipAddress: string | null; userAgent: string | null },
): Promise<ConfirmConsentResult> {
  // Duration first: it needs no I/O, and rejecting here means a grant is not
  // burned by a recording the browser should have caught (AC 9's equivalent).
  if (args.durationMs < VOICE_CONSENT_MIN_MS || args.durationMs > VOICE_CONSENT_MAX_MS) {
    return { ok: false, code: "DURATION_OUT_OF_BOUNDS" };
  }

  const grant = await db.voiceUploadGrant.findFirst({
    where: { id: args.grantId, userId: args.userId, purpose: "CONSENT_STATEMENT" },
  });
  // Scoped to the calling user, so another account's grant is indistinguishable
  // from a nonexistent one — M1 AC 33's rule.
  if (!grant) return { ok: false, code: "NOT_FOUND" };
  if (grant.consumedAt) return { ok: false, code: "ALREADY_USED" };

  const head = await storage.head(grant.pathname).catch(() => null);
  if (!head) return { ok: false, code: "NO_OBJECT" };

  const claimed = await db.voiceUploadGrant.updateMany({
    where: { id: grant.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, code: "ALREADY_USED" };

  const recording = await db.voiceConsentRecording.create({
    data: {
      userId: args.userId,
      pathname: grant.pathname,
      consentWordingVersion: VOICE_CONSENT_WORDING_VERSION,
      durationMs: args.durationMs,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    },
  });

  return { ok: true, consentRecordingId: recording.id };
}

/**
 * AC 6's gate: does this account have a usable consent recording?
 *
 * **Scoped to the CURRENT wording version.** A recording made against older
 * wording evidences agreement to words that are no longer what we ask people to
 * say, so it does not authorise a new clone. Existing voices are untouched —
 * their recording still says what was actually read, which is the whole reason
 * the version is stored on the row rather than looked up at read time.
 */
export async function findUsableConsentRecording(userId: string) {
  return db.voiceConsentRecording.findFirst({
    where: {
      userId,
      consentWordingVersion: VOICE_CONSENT_WORDING_VERSION,
      // Not already spent on a voice. One recording authorises one clone; a
      // second clone is a second act and needs its own spoken consent.
      customVoice: { is: null },
    },
    orderBy: { createdAt: "desc" },
  });
}
