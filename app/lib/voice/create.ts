import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import { hashAdultIdentity } from "@/lib/consent/audit";
import { createVoice } from "@/lib/voice/provider";
import { vendorVoiceName, vendorSampleFilename } from "@/lib/voice/naming";
import { findUsableConsentRecording } from "@/lib/voice/consent";
import { countOwnedPersonas, createOwnedPersona } from "@/lib/personas/dal";
import {
  CUSTOM_VOICE_ARTWORK_ID,
  MAX_CUSTOM_VOICES_PER_USER,
  VOICE_ATTEMPTS_PER_WINDOW,
  VOICE_ATTEMPT_WINDOW_MS,
} from "@/lib/config";

/**
 * M6 AC 13/14/15/21 — turning an uploaded sample into a usable persona.
 *
 * ## The ordering AC 14 forces
 *
 * "No persona row exists without a vendor voice id." So the vendor call happens
 * BEFORE any row is written, and every local row is created in one transaction
 * afterwards. The alternative — write the persona, then call the vendor, then
 * patch it — leaves a window in which a persona exists that can never narrate
 * anything, and a crash inside that window makes it permanent.
 *
 * The cost is the mirror-image risk: a vendor voice with no local row, if the
 * process dies between the two. That is the better failure, and deliberately so.
 * An orphaned vendor voice is invisible to every parent and every child, costs a
 * slot, and is reconcilable — the vendor name is `m6-<consentRecordingId>`, so
 * an operator can list vendor voices and find the ones we never recorded. An
 * orphaned persona is visible, selectable and broken.
 *
 * ## The sample is deleted as soon as the clone exists
 *
 * `VOICE_SAMPLE_RETENTION_DAYS` is 0: the raw sample is the most sensitive
 * object this application holds, and once the vendor has the voice we have no
 * further use for it. Deletion is attempted here rather than left to the
 * retention job — the job is the backstop, not the mechanism. A failed delete
 * does NOT fail the request: the voice exists and works, the retention sweep
 * will catch the object, and failing here would tell a parent their voice was
 * not created when it was.
 */

export type CreateCustomVoiceResult =
  | { ok: true; personaId: string; status: "ACTIVE" | "PENDING_VERIFICATION" }
  | {
      ok: false;
      code:
        | "CAP_REACHED"
        | "RATE_LIMITED"
        | "GRANT_UNUSABLE"
        | "NO_USABLE_CONSENT"
        | "SAMPLE_MISSING"
        | "VENDOR_FAILED";
      /** AC 14: only ever our own words. Never a vendor payload or error text. */
      retryable?: boolean;
    };

export async function createCustomVoice(
  storage: StoragePort,
  args: { userId: string; userEmail: string; sampleGrantId: string; label: string },
): Promise<CreateCustomVoiceResult> {
  // ── AC 15, the cap ──────────────────────────────────────────────────────
  // REVOKED voices are deliberately NOT counted. A revoked voice still holds a
  // vendor slot until slice 7's deletion frees it, but the owner has withdrawn
  // consent for it and cannot use it; making them delete it before recording a
  // new one would be a worse product for no safety gain. The vendor's own slot
  // limit is the backstop, surfaced as the provider's QUOTA failure.
  const existing = await countOwnedPersonas(args.userId, ["ACTIVE", "PENDING_VERIFICATION"]);
  if (existing >= MAX_CUSTOM_VOICES_PER_USER) return { ok: false, code: "CAP_REACHED" };

  // ── AC 15, the window ───────────────────────────────────────────────────
  // Consumed sample grants ARE the attempt counter: creation consumes exactly
  // one, and a grant is single-use, so this counts attempts rather than
  // successes without needing a separate failure log.
  const windowStart = new Date(Date.now() - VOICE_ATTEMPT_WINDOW_MS);
  const attempts = await db.voiceUploadGrant.count({
    where: { userId: args.userId, purpose: "VOICE_SAMPLE", consumedAt: { gte: windowStart } },
  });
  if (attempts >= VOICE_ATTEMPTS_PER_WINDOW) return { ok: false, code: "RATE_LIMITED" };

  const grant = await db.voiceUploadGrant.findFirst({
    where: { id: args.sampleGrantId, userId: args.userId, purpose: "VOICE_SAMPLE" },
  });
  if (!grant || grant.consumedAt) return { ok: false, code: "GRANT_UNUSABLE" };

  // AC 6 again, at the last possible moment. Checked at grant time too; consent
  // can have been revoked or spent in between, and this is the step that would
  // otherwise ship the bytes to a third party.
  const recording = await findUsableConsentRecording(args.userId);
  if (!recording) return { ok: false, code: "NO_USABLE_CONSENT" };

  const head = await storage.head(grant.pathname).catch(() => null);
  if (!head) return { ok: false, code: "SAMPLE_MISSING" };

  // Claimed with a guarded updateMany, not read-then-write: two concurrent
  // creates for one grant would otherwise both pass the check above and both
  // bill a vendor voice. Same compare-and-swap as `confirmConsentRecording`.
  const claimed = await db.voiceUploadGrant.updateMany({
    where: { id: grant.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, code: "GRANT_UNUSABLE" };

  const sample = await storage.readBytes(grant.pathname);

  const created = await createVoice({
    name: vendorVoiceName(recording.id),
    sample,
    sampleContentType: grant.contentType,
    sampleFilename: vendorSampleFilename(grant.contentType),
  });

  if (!created.ok) {
    // AC 14. The caller gets a shape it can turn into a plain message with a
    // retry. `failureCode` stays inside this module and the provider's logs —
    // nothing derived from the vendor's response body crosses this boundary.
    return { ok: false, code: "VENDOR_FAILED", retryable: created.retryable };
  }

  // AC 13, demoted to a defensive branch by the measurement (plan §0): the
  // vendor reports `requires_verification: false` in every measured case. It is
  // carried through rather than assumed, because a vendor can change this
  // without telling us.
  const status = created.requiresVerification ? "PENDING_VERIFICATION" : "ACTIVE";

  const persona = await db.$transaction(async (tx) => {
    const row = await createOwnedPersona(tx, {
      viewerUserId: args.userId,
      slug: `custom-${recording.id}`,
      label: args.label,
      description: "A voice recorded by the account holder.",
      artworkId: CUSTOM_VOICE_ARTWORK_ID,
      providerVoiceId: created.providerVoiceId,
      status,
    });

    await tx.customVoice.create({
      data: {
        userId: args.userId,
        personaId: row.id,
        voiceConsentRecordingId: recording.id,
        samplePathname: grant.pathname,
        providerVoiceId: created.providerVoiceId,
        requiresVerification: created.requiresVerification,
      },
    });

    // AC 7: the consent recording records which voice it authorised.
    await tx.voiceConsentRecording.update({
      where: { id: recording.id },
      data: { resultingProviderVoiceId: created.providerVoiceId },
    });

    // AC 21. No foreign keys, so it survives the purge it exists to record.
    await tx.voiceCreationAudit.create({
      data: {
        event: "CREATED",
        userId: args.userId,
        actorHash: hashAdultIdentity(args.userEmail),
        providerVoiceId: created.providerVoiceId,
        consentWordingVersion: recording.consentWordingVersion,
      },
    });

    return row;
  });

  // AC 11 / VOICE_SAMPLE_RETENTION_DAYS = 0. Best effort, blob-first then the
  // column, so a failed delete leaves a pathname the retention sweep can still
  // find rather than an orphaned object nothing points at (ADR-0007's ordering).
  try {
    await storage.del([grant.pathname]);
    await db.customVoice.update({
      where: { personaId: persona.id },
      data: { samplePathname: null, sampleDeletedAt: new Date() },
    });
  } catch {
    // Deliberately swallowed: the voice exists and works. Telling the parent
    // their voice failed because a cleanup step did would be a lie, and the
    // retention job is the backstop for exactly this.
  }

  return { ok: true, personaId: persona.id, status };
}
