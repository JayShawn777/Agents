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
 * `hasNotice` defaults to `false`, which is always correct for a
 * newly-created profile (endpoint 2) and must be passed explicitly by any
 * caller that has actually checked for a `DirectNotice` row (endpoint 3).
 */
export function toStudentProfileDTO(
  profile: StudentProfile,
  opts: { hasNotice?: boolean } = {},
): StudentProfileDTO {
  const hasNotice = opts.hasNotice ?? false;
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

