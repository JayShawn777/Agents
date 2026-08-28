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

import type { ErrorCode } from "@/lib/errors";
import type { DrawOp } from "@/lib/lessons/script-schema";
import type {
  AgeBand,
  AnswerFormat,
  AttemptResult,
  ChatRole,
  ChatSessionStatus,
  ConsentMethod,
  LessonFlagReason,
  LessonStatus,
  ConsentRelationship,
  ExtractionStatus,
  GradeLevel,
  MasteryLevel,
  PracticeSetKind,
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
  /** ADR-0017. Which kind of set this is — the client renders a checkpoint differently. */
  kind: PracticeSetKind;
  /** ADR-0017. NULL for a CHECKPOINT, which is not built from any single worksheet. */
  extractionId: string | null;
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
  /**
   * M2.5 AC 12: how many were right, out of `totalAnswered`.
   *
   * Allowed, and the distinction matters. Spec AC 13 forbids a value LOWER
   * than one previously rendered — a percentage that was 80 last month and is
   * 60 now. "6 of 8" for THIS set is a point-in-time outcome and is explicitly
   * fine. What must never be built on top of it is a history, a trend or a
   * comparison to an earlier checkpoint.
   *
   * Practice surfaces do not render it (M2 AC 20's "no score" is unchanged);
   * only the checkpoint result does.
   */
  totalCorrect: number;
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

// ─────────────────────────── M3: the chat tutor ───────────────────────────

export type ChatSessionDTO = {
  id: string;
  status: ChatSessionStatus;
  /** AC 1: a session is bound to exactly ONE of these and never re-pointed. */
  subject: { kind: "EXTRACTED_PROBLEM" | "ATTEMPT"; id: string };
  studentTurnCount: number;
  maxStudentTurns: number;
  expiresAt: string;
  openedAt: string;
  closedAt: string | null;
  // NOTE: renderedContext, contextHash, contextVersion, systemPromptVersion and
  // model are NEVER in a DTO. `renderedContext` is the student's mastery
  // summary rendered for the model; it is not copy anybody wrote for a child
  // to read, and ADR-0012 §2 keeps it server-side.
};

export type ChatMessageDTO = {
  id: string;
  role: ChatRole;
  content: string;
  /** Server-rendered KaTeX, matching M1/M2 (AC 17). Null when the text carries no math. */
  contentHtml: string | null;
  sequence: number;
  /** AC 12: the stream was aborted; this is what had been generated. Render it as incomplete. */
  partial: boolean;
  /** AC 13: the output token cap was hit and the reply stops mid-thought. */
  truncated: boolean;
  /** AC 21: fixed safety copy, not model output. */
  safetyResponse: boolean;
  createdAt: string;
  // NOTE: token counts, cache metrics and `clientTurnId` are NEVER in a DTO.
};

export type ChatSessionDetailResponse = {
  session: ChatSessionDTO;
  messages: ChatMessageDTO[];
};

/**
 * ADR-0013 §1. The NDJSON wire format — one JSON object per `\n`-terminated
 * line, and the ONE place in this app where a success body is not
 * `ApiResult<T>`.
 *
 * Order is always: exactly one `turn`, then zero or more `delta`, then exactly
 * one of `done` or `error`. Never both, and never a `delta` after a terminal
 * event. A socket that closes with no terminal event is a client-side idle
 * timeout, not a success.
 */
export type ChatStreamEvent =
  | { type: "turn"; userMessage: ChatMessageDTO; assistantMessageId: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessageDTO; session: ChatSessionDTO }
  | { type: "error"; code: ErrorCode; message: string };

// ─────────────────────────── M4: whiteboard lessons ───────────────────────────

/**
 * A `write` op with its LaTeX already rendered to HTML on the server
 * (ADR-0019 §3). Because a script is authored and STORED before anyone plays
 * it, the rendering is known ahead of time — so the player positions HTML
 * fragments and **no KaTeX JavaScript ships to the browser**, the same rule M1,
 * M2 and M3 follow.
 *
 * `latex` is kept alongside `latexHtml`, deliberately: AC 16's static text view
 * needs something a person can read, and a screen reader must not be handed
 * KaTeX markup.
 */
export type RenderableDrawOp =
  | (Extract<DrawOp, { kind: "write" }> & { latexHtml: string })
  | Exclude<DrawOp, { kind: "write" }>;

export type RenderableLessonStep = {
  id: string;
  narration: string;
  durationMs: number;
  ops: RenderableDrawOp[];
};

export type RenderableLessonScript = {
  title: string;
  steps: RenderableLessonStep[];
};

export type LessonDTO = {
  id: string;
  status: LessonStatus;
  /** AC 5: bound to exactly ONE, and never re-pointed. */
  subject: { kind: "EXTRACTED_PROBLEM" | "PRACTICE_PROBLEM"; id: string };
  currentVersionId: string | null;
  versionCount: number;
  /** AC 10: from `LESSON_FAILURE_MESSAGES` only. Never a model id or provider payload. */
  failureMessage: string | null;
  createdAt: string;
};

export type LessonVersionDTO = {
  id: string;
  version: number;
  status: LessonStatus;
  /** NULL unless READY — AC 2's "zero steps persisted", as a shape rather than a promise. */
  script: RenderableLessonScript | null;
  stepCount: number | null;
  totalDurationMs: number | null;
  /**
   * AC 7. Derived at persistence as the running sum of durations, never
   * authored — so the timeline is monotonic by construction. The player takes
   * it through a `CueSource` so M5 can replace it with narration timings
   * without rewriting the player.
   */
  timeline: { stepId: string; startOffsetMs: number; durationMs: number }[] | null;
  // NOTE: model, effort, promptVersion, failureCode, schemaVersion and token
  // counts are NEVER in a DTO.
};

/**
 * The flag reasons as a client-safe union. Client components need the VALUES
 * (to send one) as well as the type, and `lib/domain/enums` is the one seam
 * where a Prisma enum is allowed to reach the browser.
 */
export type LessonFlagReasonValue = LessonFlagReason;

export type LessonFlagDTO = {
  id: string;
  versionId: string;
  stepIndex: number | null;
  reason: LessonFlagReason;
  createdAt: string;
};

export type LessonDetailResponse = {
  lesson: LessonDTO;
  /** The CURRENT version, or null before the first authoring run finishes. */
  version: LessonVersionDTO | null;
};
