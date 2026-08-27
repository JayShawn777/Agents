import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { EXTRACTION_TIMEOUT_MS } from "@/lib/config";

/**
 * Thrown when extraction is actually attempted and `ANTHROPIC_API_KEY` is
 * missing. Deliberately NOT thrown at module import time: `ANTHROPIC_API_KEY`
 * is not set in this environment, and every other route/test that merely
 * imports something from `lib/ai/*` or `lib/extraction/*` must keep working.
 * This is "a clear startup failure on the extraction path only" (this
 * milestone's brief) — `lib/extraction/run-extraction.ts` catches this
 * specific class and maps it to `failureCode: 'INTERNAL'`, a `FAILED`
 * extraction, NEVER a silent `COMPLETE_EMPTY` with zero problems. A missing
 * key must look like a failure, not like an empty page.
 */
export class MissingAnthropicApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set. Extraction cannot run without it.");
    this.name = "MissingAnthropicApiKeyError";
  }
}

let cachedClient: Anthropic | null = null;

/**
 * Lazily constructs the Anthropic client, cached for the life of the
 * process. `maxRetries: 0` is deliberate (ADR-0005): the SDK's own default
 * worst-case wall clock is `timeout * (maxRetries + 1)`, which would blow the
 * Vercel function duration budget on top of an already-slow `effort: 'high'`
 * call — this app owns retries itself, at the extraction-attempt level
 * (`Extraction.attemptCount`, `MAX_EXTRACTION_ATTEMPTS`,
 * `POST /api/extractions/[id]/retry`), not at the HTTP-request level.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MissingAnthropicApiKeyError();
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey,
      timeout: EXTRACTION_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return cachedClient;
}

/** Test-only: clears the cached client so a test can swap `ANTHROPIC_API_KEY` between cases. */
export function resetAnthropicClientForTests(): void {
  cachedClient = null;
}
