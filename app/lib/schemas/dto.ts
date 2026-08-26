/**
 * Shared DTOs (plan §3, S8) — the only shapes crossing the API boundary.
 * These are TYPES ONLY: no mapping functions live here. Building one of
 * these from a Prisma row is a service-layer concern (backend track); this
 * file exists so both tracks agree on the shape without either importing
 * the other's code.
 *
 * `Upload.pathname`, `ParentalConsent.methodEvidence`, the consent challenge
 * token and any signed URL NEVER appear in a DTO, in HTML, or in any client
 * payload (plan §3). Every date field is a serialized ISO string, never a
 * `Date` — DTOs cross a JSON boundary.
 */

import type {
  AgeBand,
  ConsentMethod,
  ConsentRelationship,
  ExtractionStatus,
  GradeLevel,
  StudentProfileStatus,
  Subject,
  UploadStatus,
} from "@/lib/domain/enums";

export type StudentProfileDTO = {
  id: string;
  ageBand: AgeBand;
  status: StudentProfileStatus;
  /**
   * NULL until the detail step is completed, which can only happen once
   * `ACTIVE`. Consumers MUST render a "finish setting up" state for a null
   * `displayName` on an `ACTIVE` profile — do not soften this to `string`.
   */
  displayName: string | null;
  gradeLevel: GradeLevel | null;
  subjects: Subject[]; // [] until the detail step
  avatarId: string | null;
  /** Derived, so the client never re-implements the state machine. */
  nextStep: "NOTICE" | "CONSENT" | "CONSENT_PENDING" | "PROFILE_DETAILS" | "NONE";
  canUpload: boolean; // === (status === 'ACTIVE')
  createdAt: string;
};

export type DirectNoticeDTO = {
  id: string;
  noticeVersion: string;
  presentedAt: string;
  sentAt: string | null;
};

export type ConsentDTO = {
  id: string;
  method: ConsentMethod;
  consentTextVersion: string;
  noticeVersion: string;
  relationship: ConsentRelationship;
  submittedAt: string;
  verifiedAt: string | null;
  withdrawnAt: string | null;
  // NOTE: methodEvidence, ipAddress and userAgent are NEVER in a DTO.
};

export type UploadDTO = {
  id: string;
  studentProfileId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: UploadStatus;
  createdAt: string; // NOTE: pathname is never in a DTO
};

export type ExtractionDTO = {
  id: string;
  uploadId: string;
  status: ExtractionStatus;
  failureMessage: string | null; // from the fixed allowlist only (lib/errors.ts)
  problemCount: number;
  completedAt: string | null;
};

export type ExtractedProblemDTO = {
  id: string;
  ordinal: number;
  label: string | null;
  text: string;
  containsMath: boolean;
  subject: Subject | null;
  problemType: string | null;
  studentAnswerText: string | null;
  confidence: number;
  lowConfidence: boolean;
  studentCorrected: boolean;
};

// ─────────────────────────── response envelopes ───────────────────────────
// Named here (not re-derived per route) so both tracks agree on the exact
// success-body shape for each endpoint in plan §3.2.

export type StudentDetailResponse = {
  student: StudentProfileDTO;
  consent: ConsentDTO | null;
  notice: DirectNoticeDTO | null;
};

export type UploadDetailResponse = {
  upload: UploadDTO;
  extraction: ExtractionDTO | null;
};

export type ExtractionDetailResponse = {
  extraction: ExtractionDTO;
  problems: ExtractedProblemDTO[];
};
