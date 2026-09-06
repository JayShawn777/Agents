import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import { hashAdultIdentity } from "@/lib/consent/audit";
import { deleteVoice } from "@/lib/voice/provider";
import { deleteOwnedPersona, listOwnedPersonas, revokeOwnedPersona } from "@/lib/personas/dal";

/**
 * M6 AC 18/19/20/21 — removing a cloned voice, everywhere it exists.
 *
 * ## The rule this module exists to enforce
 *
 * **A deletion that stops at our database is not a deletion.** The voice lives
 * at a third party; removing our row leaves a model of a real adult's voice on
 * someone else's infrastructure, still usable by anyone holding the account's
 * API key. Every path that removes a custom voice comes through here.
 *
 * ## Why the vendor is called FIRST, and why failure does not stop us
 *
 * The vendor call happens before the local rows, the mirror image of
 * `create.ts`'s ordering and for the same reason: whichever half we do second is
 * the half a crash can lose, so the half we cannot retry blindly goes first.
 * After the local rows are gone we no longer know the `providerVoiceId`, and the
 * vendor voice becomes an orphan nobody can find.
 *
 * But a vendor failure must NOT abort the local deletion. A parent who asked for
 * their voice to be deleted, or whose account is being purged, gets the local
 * deletion regardless — refusing would leave the voice selectable and narrating
 * after they revoked consent, which is the worse outcome by a wide margin.
 * Instead the failure is recorded as a `VENDOR_DELETE_FAILED` audit row carrying
 * the `providerVoiceId`, so an operator can finish the job by hand. A deletion
 * that fails silently is worse than one that errors (plan §5).
 */

export type VoiceRemoval = {
  personaId: string;
  providerVoiceId: string;
  /** False when the vendor refused or was unreachable — an audit row exists. */
  vendorDeleted: boolean;
};

/**
 * Deletes the voice at the vendor and records the outcome. Never throws: the
 * caller's local deletion must proceed either way.
 */
async function removeAtVendor(args: {
  userId: string | null;
  actorHash: string;
  providerVoiceId: string;
  consentWordingVersion: string | null;
}): Promise<boolean> {
  let ok = false;
  try {
    const result = await deleteVoice(args.providerVoiceId);
    // `alreadyGone` is a success: the desired end state is "not at the vendor".
    ok = result.ok;
  } catch {
    ok = false;
  }

  await db.voiceCreationAudit.create({
    data: {
      event: ok ? "DELETED" : "VENDOR_DELETE_FAILED",
      userId: args.userId,
      actorHash: args.actorHash,
      providerVoiceId: args.providerVoiceId,
      consentWordingVersion: args.consentWordingVersion,
    },
  });

  return ok;
}

/**
 * AC 19. Removes every cached narration asset generated with this voice.
 *
 * Matched on `providerVoiceId`, NOT on `personaId`: `NarrationAsset.personaId`
 * is `SetNull`, so a row whose persona has already gone would no longer match by
 * persona and its audio — a real adult's voice reading a child's homework —
 * would survive the deletion that was supposed to remove it.
 *
 * Blob-first, then rows (ADR-0007): a failure leaves a row pointing at a
 * possibly-absent object, which the reconciler can see, rather than an object no
 * row claims, which nothing can find.
 */
async function removeNarrationAssets(storage: StoragePort, providerVoiceId: string): Promise<void> {
  const assets = await db.narrationAsset.findMany({
    where: { providerVoiceId },
    select: { pathname: true },
  });
  if (assets.length === 0) return;
  await storage.del(assets.map((a) => a.pathname));
  await db.narrationAsset.deleteMany({ where: { providerVoiceId } });
}

/** The sample, if the creation path's own delete did not already get it. */
async function removeSampleIfPresent(storage: StoragePort, samplePathname: string | null): Promise<void> {
  if (!samplePathname) return;
  await storage.del([samplePathname]);
}

/**
 * AC 19. The explicit "delete this voice" path (endpoint 52), and the unit of
 * work every other path reuses.
 *
 * Scoped to the owner throughout, so another account's persona is
 * indistinguishable from one that does not exist.
 */
export async function deleteCustomVoice(
  storage: StoragePort,
  args: { userId: string; userEmail: string; personaId: string },
): Promise<{ ok: true; removal: VoiceRemoval } | { ok: false; code: "NOT_FOUND" }> {
  const voice = await db.customVoice.findFirst({
    where: { personaId: args.personaId, userId: args.userId },
    select: {
      providerVoiceId: true,
      samplePathname: true,
      consentRecording: { select: { consentWordingVersion: true } },
    },
  });
  if (!voice) return { ok: false, code: "NOT_FOUND" };

  const actorHash = hashAdultIdentity(args.userEmail);
  const vendorDeleted = await removeAtVendor({
    userId: args.userId,
    actorHash,
    providerVoiceId: voice.providerVoiceId,
    consentWordingVersion: voice.consentRecording?.consentWordingVersion ?? null,
  });

  await removeNarrationAssets(storage, voice.providerVoiceId);
  await removeSampleIfPresent(storage, voice.samplePathname);

  // The persona delete cascades `CustomVoice` and SetNulls every
  // `StudentProfile.personaId` that pointed here — which IS AC 18's fallback:
  // a null persona means "the default" (`lib/schemas/student.ts`). No profile
  // is left pointing at a voice that no longer exists.
  await deleteOwnedPersona(args.userId, args.personaId);

  return {
    ok: true,
    removal: { personaId: args.personaId, providerVoiceId: voice.providerVoiceId, vendorDeleted },
  };
}

/**
 * AC 18 — revocation (endpoint 53).
 *
 * **Revocation deletes at the vendor too, and that is deliberate.** AC 18 by
 * itself only requires the persona to become unselectable. But the consent
 * statement the parent recorded says, in their own voice, "I can withdraw this
 * permission and have the voice deleted at any time" — so a revocation that left
 * the clone alive at a third party would make that sentence false. What
 * revocation does NOT do is remove already-cached narration: that audio is
 * AC 19's separate, explicit act, and a child mid-lesson does not lose the
 * lesson because a parent changed a setting.
 *
 * The persona row stays, marked `REVOKED`, so the account still shows what it
 * owns and cached audio keeps its attribution.
 */
export async function revokeCustomVoice(args: {
  userId: string;
  userEmail: string;
  personaId: string;
}): Promise<{ ok: true; removal: VoiceRemoval } | { ok: false; code: "NOT_FOUND" }> {
  const voice = await db.customVoice.findFirst({
    where: { personaId: args.personaId, userId: args.userId },
    select: {
      providerVoiceId: true,
      consentRecording: { select: { consentWordingVersion: true } },
    },
  });
  if (!voice) return { ok: false, code: "NOT_FOUND" };

  const revoked = await revokeOwnedPersona(args.userId, args.personaId);
  if (revoked === 0) return { ok: false, code: "NOT_FOUND" };

  // AC 18's fallback, explicit here because the row survives: a REVOKED persona
  // is still a valid foreign key, so nothing nulls these for us the way a delete
  // would. A profile left pointing at it would keep resolving to a voice that
  // may no longer be generated with.
  await db.studentProfile.updateMany({
    where: { personaId: args.personaId },
    data: { personaId: null },
  });

  const vendorDeleted = await removeAtVendor({
    userId: args.userId,
    actorHash: hashAdultIdentity(args.userEmail),
    providerVoiceId: voice.providerVoiceId,
    consentWordingVersion: voice.consentRecording?.consentWordingVersion ?? null,
  });

  return {
    ok: true,
    removal: { personaId: args.personaId, providerVoiceId: voice.providerVoiceId, vendorDeleted },
  };
}

/**
 * AC 20 — the account-deletion path.
 *
 * Called by `purgeClosedAccounts` BEFORE `user.delete`, because that cascade
 * removes the persona and `CustomVoice` rows locally and would take the
 * `providerVoiceId` with them — leaving a voice at the vendor that nothing in
 * our system can name.
 *
 * **Scope note, flagged for the owner.** Spec AC 20 reads "given a student
 * profile OR the whole account is deleted ... the account's custom voices are
 * deleted at the vendor". Taken literally, deleting ONE child's profile would
 * destroy the parent's voice while their other children still use it. That is
 * almost certainly not the intent — a custom voice is account-level, not
 * profile-level — so this is wired to ACCOUNT deletion only. Profile deletion
 * already removes that profile's narration assets through
 * `PROFILE_BLOB_SOURCES`, which is the profile-scoped half of the same concern.
 * If the strict reading is wanted, this function is the seam.
 */
export async function deleteAllCustomVoicesForUser(
  storage: StoragePort,
  args: { userId: string; userEmail: string },
): Promise<VoiceRemoval[]> {
  const personas = await listOwnedPersonas(args.userId);
  const removals: VoiceRemoval[] = [];
  for (const persona of personas) {
    const result = await deleteCustomVoice(storage, {
      userId: args.userId,
      userEmail: args.userEmail,
      personaId: persona.id,
    });
    if (result.ok) removals.push(result.removal);
  }
  return removals;
}
