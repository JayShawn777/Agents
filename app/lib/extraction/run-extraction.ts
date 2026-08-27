import "server-only";

import { resolveProblemLanguage } from "@/lib/extraction/language";

import Anthropic, { AnthropicError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { db } from "@/lib/db";
import type { Extraction } from "@/lib/generated/prisma/client";
import { getAnthropicClient, MissingAnthropicApiKeyError } from "@/lib/ai/client";
import { ExtractionResultSchema, type ExtractedProblemOutput } from "@/lib/ai/extraction-schema";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt } from "@/lib/ai/prompt";
import { getStoragePort } from "@/lib/storage/get-storage";
import type { StoragePort } from "@/lib/storage/port";
import { EXTRACTION_EFFORT, EXTRACTION_MODEL, EXTRACTION_TIMEOUT_MS } from "@/lib/config";
import type { ExtractionFailureCode } from "@/lib/errors";

/**
 * The status machine (ADR-0005, B20). One entry point, `runExtraction`,
 * scheduled with `after()` immediately after `Upload`/`Extraction` are
 * created (`lib/uploads/record-upload.ts`, B17) and re-triggered by
 * `POST /api/extractions/[id]/retry` (B21). `reapIfStale` is the OTHER half
 * of the machine — called from the status GET (endpoint 19) so a client
 * polling a `RUNNING` extraction whose function died mid-flight still always
 * reaches a terminal state (M1 AC 27).
 *
 * Every failure mode lands in exactly one of the four internal codes
 * (`lib/errors.ts`'s `EXTRACTION_FAILURE_CODES`), checked in this order, most
 * specific first (ADR-0005 / research §7-8): refusal, then a null structured
 * parse, then a connection timeout, then any other typed SDK error, then
 * anything else. Nothing here string-matches an exception message, and
 * nothing here ever returns the model id, the raw provider payload, or an
 * exception message to a caller — `RunExtractionResult` carries only the
 * internal failure code, and the API layer (`lib/uploads/dto.ts`) maps THAT
 * through the fixed allowlist (M1 AC 24).
 */

export type RunExtractionResult =
  | { status: "COMPLETE"; problemCount: number }
  | { status: "COMPLETE_EMPTY" }
  | { status: "FAILED"; failureCode: ExtractionFailureCode }
  /**
   * Returned when `runExtraction` is invoked against a row that is no
   * longer `PENDING` (already `RUNNING` from a racing trigger, or already
   * terminal). Never fabricated data to force this into one of the shapes
   * above — a caller that cares about the eventual outcome re-reads the row.
   */
  | { status: "SKIPPED" };

/**
 * Runs one extraction attempt end to end. `storage` is injectable for tests
 * (matching every other job/service in this codebase, e.g.
 * `lib/jobs/reconcile-blobs.ts`); production callers rely on the default.
 */
export async function runExtraction(
  extractionId: string,
  storage: StoragePort = getStoragePort(),
): Promise<RunExtractionResult> {
  const extraction = await db.extraction.findUnique({
    where: { id: extractionId },
    include: { upload: { select: { pathname: true, contentType: true } } },
  });
  if (!extraction) {
    throw new Error(`runExtraction: no Extraction row for id "${extractionId}".`);
  }

  if (extraction.status !== "PENDING") {
    return { status: "SKIPPED" };
  }

  await db.extraction.update({
    where: { id: extractionId },
    data: { status: "RUNNING", startedAt: new Date(), attemptCount: { increment: 1 } },
  });

  try {
    const bytes = await storage.readBytes(extraction.upload.pathname);
    const base64 = Buffer.from(bytes).toString("base64");
    const contentBlock = buildContentBlock(extraction.upload.contentType, base64);

    const client = getAnthropicClient();
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [contentBlock, { type: "text", text: buildExtractionUserPrompt() }],
        },
      ],
      output_config: {
        format: zodOutputFormat(ExtractionResultSchema),
        effort: EXTRACTION_EFFORT,
      },
    });

    // Checked most specific first (ADR-0005): a refusal is a 200 with
    // `stop_reason: 'refusal'` — always check this before reading `content`
    // or `parsed_output` (research §7).
    if (response.stop_reason === "refusal") {
      return await finalizeFailed(extractionId, "REFUSED");
    }

    // `parsed_output` is null on a parse failure — guarded, never `!`-asserted
    // (research §3, ADR-0005 AC 23).
    const parsed = response.parsed_output;
    if (parsed === null) {
      return await finalizeFailed(extractionId, "PARSE_FAILED");
    }

    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

    if (!parsed.containsSchoolwork || parsed.problems.length === 0) {
      return await finalizeSuccess(extractionId, { status: "COMPLETE_EMPTY", usage });
    }

    return await finalizeSuccess(extractionId, { status: "COMPLETE", problems: parsed.problems, usage });
  } catch (err) {
    const failureCode = classifyFailure(err);
    console.error(`runExtraction(${extractionId}) failed`, err);
    return await finalizeFailed(extractionId, failureCode);
  }
}

/**
 * AC 27's "no request left hanging in the browser": called from the status
 * GET (`app/api/extractions/[extractionId]/route.ts`, endpoint 19) on every
 * read. A `RUNNING` extraction whose `startedAt` is older than
 * `EXTRACTION_TIMEOUT_MS + 30s` (a grace margin past the SDK's own timeout,
 * for whatever wall-clock slop getting the response back and written takes)
 * covers the case where the function running `runExtraction` was killed
 * before it ever reached its own `catch` block — the client polling this
 * extraction must still always reach a terminal state.
 */
export async function reapIfStale(extraction: Extraction): Promise<Extraction> {
  if (extraction.status !== "RUNNING" || extraction.startedAt === null) {
    return extraction;
  }
  const deadline = extraction.startedAt.getTime() + EXTRACTION_TIMEOUT_MS + 30_000;
  if (Date.now() < deadline) {
    return extraction;
  }

  const completedAt = new Date();
  // Guarded by `status: 'RUNNING'` so this can never clobber a terminal
  // write that landed concurrently (e.g. the original function recovered
  // and finished just before this GET ran).
  const result = await db.extraction.updateMany({
    where: { id: extraction.id, status: "RUNNING" },
    data: { status: "FAILED", failureCode: "TIMEOUT", completedAt },
  });
  if (result.count === 0) {
    return db.extraction.findUniqueOrThrow({ where: { id: extraction.id } });
  }
  return { ...extraction, status: "FAILED", failureCode: "TIMEOUT", completedAt };
}

// ─────────────────────────── internals ───────────────────────────

function buildContentBlock(
  contentType: string,
  base64: string,
): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  if (contentType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  }
  // `ALLOWED_UPLOAD_CONTENT_TYPES` (lib/config.ts) restricts what
  // `lib/uploads/record-upload.ts` ever writes to `image/jpeg` | `image/png`
  // | `image/webp` | `application/pdf` — narrower than Anthropic's own
  // `Base64ImageSource` union (which also accepts `image/gif`), so this cast
  // is total over every content type this app can ever hand it.
  return {
    type: "image",
    source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/webp", data: base64 },
  };
}

/**
 * Typed SDK error classes, checked most specific first (research §8): a
 * timeout is a subclass of a connection error, which is a subclass of
 * `APIError`, which is a subclass of `AnthropicError` — checking the base
 * class first would misclassify every one of its subclasses.
 */
function classifyFailure(err: unknown): ExtractionFailureCode {
  if (err instanceof MissingAnthropicApiKeyError) return "INTERNAL";
  if (err instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (err instanceof AnthropicError) return "UPSTREAM";
  return "INTERNAL";
}

async function finalizeFailed(
  extractionId: string,
  failureCode: ExtractionFailureCode,
): Promise<RunExtractionResult> {
  // AC 23: a FAILED extraction never has a partial row — this path never
  // touches `ExtractedProblem` and never stamps `Upload.extractedAt`, so the
  // 14-day source-file retention window (M0/M1 AC 36) never starts for an
  // extraction that didn't succeed; `lib/jobs/enforce-retention.ts` instead
  // deletes a FAILED upload's blob immediately, with no window at all.
  await db.extraction.update({
    where: { id: extractionId },
    data: { status: "FAILED", failureCode, completedAt: new Date() },
  });
  return { status: "FAILED", failureCode };
}

type SuccessOutcome =
  | { status: "COMPLETE"; problems: ExtractedProblemOutput[]; usage: { inputTokens: number; outputTokens: number } }
  | { status: "COMPLETE_EMPTY"; usage: { inputTokens: number; outputTokens: number } };

async function finalizeSuccess(extractionId: string, outcome: SuccessOutcome): Promise<RunExtractionResult> {
  const now = new Date();

  // AC 23's "no partial extraction": the terminal write and the
  // `ExtractedProblem` inserts are ONE transaction. There is no code path
  // that writes problems outside it.
  await db.$transaction(async (tx) => {
    const updated = await tx.extraction.update({
      where: { id: extractionId },
      data: {
        status: outcome.status,
        completedAt: now,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
      },
    });

    if (outcome.status === "COMPLETE") {
      await tx.extractedProblem.createMany({
        data: outcome.problems.map((problem) => ({
          extractionId,
          ordinal: problem.ordinal,
          label: problem.label,
          text: problem.text,
          containsMath: problem.containsMath,
          subject: problem.subject,
          // ADR-0016. Discarded for every non-foreign-language problem and for
          // any tag outside SUPPORTED_LANGUAGES, which is empty until the
          // ACTFL skills land — so this is null for everything today, by design.
          language: resolveProblemLanguage({ subject: problem.subject, reported: problem.language }),
          problemType: problem.problemType,
          studentAnswerText: problem.studentAnswerText,
          confidence: problem.confidence,
        })),
      });
    }

    // RETENTION ANCHOR (M1 AC 36): stamped inside the SAME transaction as the
    // terminal write, guarded by `extractedAt: null` so a later re-read (or
    // endpoint 21's own defensive re-stamp) can never push the window back
    // out.
    await tx.upload.updateMany({
      where: { id: updated.uploadId, extractedAt: null },
      data: { extractedAt: now },
    });
  });

  return outcome.status === "COMPLETE"
    ? { status: "COMPLETE", problemCount: outcome.problems.length }
    : { status: "COMPLETE_EMPTY" };
}
