import "server-only";

import type { ExtractedProblem, Extraction, Upload } from "@/lib/generated/prisma/client";
import type { ExtractedProblemDTO, ExtractionDTO, UploadDTO } from "@/lib/schemas/dto";
import { EXTRACTION_FAILURE_CODES, EXTRACTION_FAILURE_MESSAGES, ERROR_MESSAGES, type ExtractionFailureCode } from "@/lib/errors";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/config";

/**
 * Mapping functions for the upload/extraction DTOs (plan §3, S8). The only
 * place these shapes are built from Prisma rows — no route re-derives them.
 * `Upload.pathname` never appears here (plan §3: never in a DTO).
 */

export function toUploadDTO(upload: Upload): UploadDTO {
  return {
    id: upload.id,
    studentProfileId: upload.studentProfileId,
    originalFilename: upload.originalFilename,
    contentType: upload.contentType,
    sizeBytes: upload.sizeBytes,
    pageCount: upload.pageCount,
    status: upload.status,
    createdAt: upload.createdAt.toISOString(),
  };
}

/**
 * `problemCount` is passed explicitly rather than read off a relation this
 * function doesn't have — callers that already loaded `problems` pass
 * `.length`; callers that only loaded a `_count` pass that number instead.
 */
export function toExtractionDTO(extraction: Extraction, problemCount: number): ExtractionDTO {
  return {
    id: extraction.id,
    uploadId: extraction.uploadId,
    status: extraction.status,
    failureMessage: mapFailureCodeToMessage(extraction.failureCode),
    problemCount,
    completedAt: extraction.completedAt ? extraction.completedAt.toISOString() : null,
  };
}

export function toExtractedProblemDTO(problem: ExtractedProblem): ExtractedProblemDTO {
  return {
    id: problem.id,
    ordinal: problem.ordinal,
    label: problem.label,
    text: problem.text,
    containsMath: problem.containsMath,
    subject: problem.subject,
    problemType: problem.problemType,
    studentAnswerText: problem.studentAnswerText,
    confidence: problem.confidence,
    lowConfidence: problem.confidence < LOW_CONFIDENCE_THRESHOLD,
    studentCorrected: problem.studentCorrected,
  };
}

/**
 * M1 AC 24: `Extraction.failureCode` is an internal code that may, in a
 * future failure mode, carry more detail than the fixed four values below —
 * this is a type guard, not a cast, so an unrecognized value falls back to
 * the generic internal-error message rather than ever being returned
 * verbatim.
 */
function mapFailureCodeToMessage(failureCode: string | null): string | null {
  if (failureCode === null) return null;
  if ((EXTRACTION_FAILURE_CODES as readonly string[]).includes(failureCode)) {
    return EXTRACTION_FAILURE_MESSAGES[failureCode as ExtractionFailureCode];
  }
  return ERROR_MESSAGES.INTERNAL_ERROR;
}
