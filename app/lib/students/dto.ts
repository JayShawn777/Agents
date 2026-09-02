import "server-only";

import type { DirectNotice, ParentalConsent, StudentProfile } from "@/lib/generated/prisma/client";
import type { ConsentDTO, DirectNoticeDTO, StudentProfileDTO } from "@/lib/schemas/dto";

/**
 * Maps a `StudentProfile` row to the wire DTO (plan §3). The only mapping
 * function for this shape — no route re-derives `nextStep` on its own.
 *
 * `nextStep` derivation (not spelled out verbatim in the plan's DTO type,
 * but implied by the four-step flow in plan §4 and by endpoint 2's
 * documented response for each `ageBand` branch):
 *
 *   - `NOTICE_PENDING`, no `DirectNotice` yet   -> "NOTICE"
 *   - `NOTICE_PENDING`, a `DirectNotice` exists -> "CONSENT"        (notice
 *     already served; the profile stays `NOTICE_PENDING` until consent is
 *     submitted — plan §3, endpoint 7)
 *   - `CONSENT_PENDING`                          -> "CONSENT_PENDING"
 *   - `ACTIVE`, `displayName` still null         -> "PROFILE_DETAILS"
 *   - `ACTIVE`, `displayName` set                -> "NONE"
 *   - `CONSENT_WITHDRAWN`                        -> "NONE" (collects
 *     nothing further, AC 24)
 *
 * `hasNotice` is REQUIRED, not defaulted: a caller that forgets to check
 * for a `DirectNotice` row and omits it would previously fall back to
 * `false`, which is only correct for a newly-created profile (endpoint 2).
 * For an existing `NOTICE_PENDING` profile that already has a notice
 * (endpoint 3), a silent `false` default emits `nextStep: 'NOTICE'` for a
 * profile that should show `'CONSENT'` — sending the parent back to a
 * screen that would create a duplicate notice record. Every call site must
 * say explicitly whether it checked.
 */
export function toStudentProfileDTO(
  profile: StudentProfile,
  opts: {
    hasNotice: boolean;
    /**
     * M5 AC 3/19. Optional and defaults to `null` — every call site written
     * before M5 (GET, the consent routes, both server pages) keeps working
     * unchanged; only the PATCH route (endpoint 4) resolves and passes this.
     */
    persona?: { id: string; slug: string; label: string } | null;
  },
): StudentProfileDTO {
  const { hasNotice, persona = null } = opts;
  return {
    id: profile.id,
    ageBand: profile.ageBand,
    status: profile.status,
    displayName: profile.displayName,
    gradeLevel: profile.gradeLevel,
    subjects: profile.subjects,
    avatarId: profile.avatarId,
    nextStep: deriveNextStep(profile.status, profile.displayName, hasNotice),
    canUpload: profile.status === "ACTIVE",
    createdAt: profile.createdAt.toISOString(),
    persona,
    // M5 AC 18. Directly off the row — `StudentProfile.captionsEnabled`
    // defaults `true` in the schema, so this is never undefined even for a
    // profile that predates the column.
    captionsEnabled: profile.captionsEnabled,
  };
}

function deriveNextStep(
  status: StudentProfile["status"],
  displayName: string | null,
  hasNotice: boolean,
): StudentProfileDTO["nextStep"] {
  switch (status) {
    case "NOTICE_PENDING":
      return hasNotice ? "CONSENT" : "NOTICE";
    case "CONSENT_PENDING":
      return "CONSENT_PENDING";
    case "ACTIVE":
      return displayName === null ? "PROFILE_DETAILS" : "NONE";
    case "CONSENT_WITHDRAWN":
      return "NONE";
  }
}

/** Maps a `DirectNotice` row to its DTO (plan §3, endpoint 3's response envelope). */
export function toDirectNoticeDTO(notice: DirectNotice): DirectNoticeDTO {
  return {
    id: notice.id,
    noticeVersion: notice.noticeVersion,
    presentedAt: notice.presentedAt.toISOString(),
    sentAt: notice.sentAt ? notice.sentAt.toISOString() : null,
  };
}

/**
 * Maps a `ParentalConsent` row to its DTO. `methodEvidence`, `ipAddress`
 * and `userAgent` are deliberately never read here — they must NEVER
 * appear in a DTO (plan §3).
 */
export function toConsentDTO(consent: ParentalConsent): ConsentDTO {
  return {
    id: consent.id,
    method: consent.method,
    consentTextVersion: consent.consentTextVersion,
    noticeVersion: consent.noticeVersion,
    relationship: consent.relationship,
    submittedAt: consent.submittedAt.toISOString(),
    verifiedAt: consent.verifiedAt ? consent.verifiedAt.toISOString() : null,
    withdrawnAt: consent.withdrawnAt ? consent.withdrawnAt.toISOString() : null,
  };
}

