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
  AnswerFormat,
  AttemptResult,
  ConsentMethod,
  ConsentRelationship,
  ExtractionStatus,
  GradeLevel,
  MasteryLevel,
  PracticeSetStatus,
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

// ─────────────────────────── M2: practice and mastery ───────────────────────────
// ADR-0011 §5 / M2 AC 17: NONE of these types carry a canonical answer or an
// accepted form, in any state. `workedSolution`/`workedSolutionHtml` are
// non-null ONLY once `revealed` is true, and the reveal gate itself is a
// server-side 409 (`lib/practice/generate.ts`'s sibling reveal route), not a
// client-trusted flag. `tests/unit/lib/practice/dto.test.ts` asserts every
// one of these key sets exactly, so a future convenience cannot add a
// server-only field to a DTO without failing a test.

export type PracticeSetDTO = {
  id: string;
  extractionId: string;
  status: PracticeSetStatus;
  problemCount: number;
  answeredCount: number;
  /** AC 22: ordinal of the first unanswered problem; null when none remain. */
  resumeOrdinal: number | null;
  /** From GENERATION_FAILURE_MESSAGES only (AC 6). Never a model id or payload. */
  failureMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  // NOTE: model, effort, promptVersion, taxonomyVersion, failureCode and
  // token counts are NEVER in a DTO.
};

export type PracticeProblemDTO = {
  id: string;
  ordinal: number;
  /** Plain LaTeX-bearing text. */
  text: string;
  /** Server-rendered KaTeX HTML (ADR-0005: no KaTeX JS ships for this surface). */
  textHtml: string;
  containsMath: boolean;
  answerFormat: AnswerFormat;
  choices: string[];
  skillCode: string;
  /** AC 9: what the UI renders. The raw code is carried but never displayed. */
  skillDescriptor: string;
  skillGradeLevel: GradeLevel;
  attemptCount: number;
  revealed: boolean;
  /** AC 12/17: NON-NULL ONLY once `revealed` is true. */
  workedSolution: string | null;
  workedSolutionHtml: string | null;
  // NOTE: canonicalAnswer and acceptedForms are NEVER in a DTO, in any state.
};

export type AttemptDTO = {
  id: string;
  practiceProblemId: string;
  attemptNumber: number;
  submittedAnswer: string;
  result: AttemptResult;
  createdAt: string;
  // NOTE: gradedBy and appliedToMasteryAt are NEVER in a DTO.
};

export type FeedbackDTO = {
  result: AttemptResult;
  /** Allowlisted framing copy. For UNSCORED this NEVER says the answer is wrong (AC 14). */
  message: string;
  /** AC 11: post-checked to contain neither the canonical answer nor any accepted form. */
  hint: string | null;
  hintHtml: string | null;
  retryOffered: boolean;
  attemptsRemainingBeforeReveal: number;
  revealAvailable: boolean;
};

export type SkillMasteryDTO = {
  skillCode: string;
  skillDescriptor: string;
  level: MasteryLevel;
  /** AC 20: a COUNT of problems practised — monotonic by construction. */
  problemsPracticed: number;
  lastPracticedAt: string | null;
  // NOTE: correctCount, consecutiveCorrect, modelGradedCount and
  // streakStartPracticeSetId are NEVER in a DTO (AC 20).
};

export type PracticeSetSummaryDTO = {
  skills: { skillCode: string; skillDescriptor: string; problemsAnswered: number }[];
  totalAnswered: number;
  /** AC 21: progress framing, from an allowlist. No score, no percentage, no streak. */
  message: string;
};

export type PracticeSetDetailResponse = {
  set: PracticeSetDTO;
  problems: PracticeProblemDTO[];
  attempts: AttemptDTO[];
};

export type AttemptResponse = {
  attempt: AttemptDTO;
  feedback: FeedbackDTO;
  mastery: SkillMasteryDTO;
};
