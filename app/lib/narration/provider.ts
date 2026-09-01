import "server-only";

import { z } from "zod";

/**
 * ADR-0020. The ONE file in the application that knows ElevenLabs' URL,
 * header name or payload shape. Plain `fetch`, deliberately no SDK — the
 * measurement that proved the vendor works at all (`docs/research/
 * m5-narration-measurement.md`) was taken with `fetch`, so production
 * exercises the same wire path that was actually measured (retro lesson 17:
 * a mock or an unmeasured path is how a doubt survives a test suite).
 *
 * **AC 12.** The outbound request carries exactly `text`, `model_id` and
 * `output_format` in the body, and the voice id in the URL — no profile id,
 * no lesson id, no display name, no email, no custom header.
 * `tests/unit/lib/narration/provider.test.ts` captures the request and
 * asserts its exact key set.
 */

const API_BASE = "https://api.elevenlabs.io";

const AlignmentResponseSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

/**
 * ADR-0021. We read `alignment` and NEVER `normalized_alignment` — measured
 * to come back padded with a leading AND trailing space, whose indices
 * therefore do not correspond to the text we sent. `normalized_alignment` is
 * intentionally absent from this schema so nothing downstream can reach for
 * it by accident.
 */
const SpeechResponseSchema = z.object({
  audio_base64: z.string().min(1),
  alignment: AlignmentResponseSchema,
});

/** Our own shape, camelCase — the one place the vendor's snake_case wire format is translated. */
export type NarrationAlignment = {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
};

export type SynthesizeNarrationInput = {
  /** The narration text for exactly one lesson step. Never anything else — no name, no context. */
  text: string;
  providerVoiceId: string;
  modelId: string;
  outputFormat: string;
};

export type SynthesizeNarrationSuccess = {
  ok: true;
  audio: ArrayBuffer;
  alignment: NarrationAlignment;
};

export type SynthesizeNarrationFailureCode = "TIMEOUT" | "RATE_LIMITED" | "UPSTREAM" | "INTERNAL";

export type SynthesizeNarrationFailure = {
  ok: false;
  failureCode: SynthesizeNarrationFailureCode;
  /** Whether a caller's retry loop should spend another attempt on this. */
  retryable: boolean;
};

export type SynthesizeNarrationResult = SynthesizeNarrationSuccess | SynthesizeNarrationFailure;

/**
 * One synthesis call. No retry, no backoff, no concurrency limiting — those
 * are `lib/narration/generate.ts`'s job (AC 9), because they need to reason
 * about a whole lesson's worth of steps at once. This function does exactly
 * one HTTP round trip and classifies the outcome.
 */
export async function synthesizeNarration(
  input: SynthesizeNarrationInput,
  opts?: { signal?: AbortSignal; apiKey?: string },
): Promise<SynthesizeNarrationResult> {
  const apiKey = opts?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("synthesizeNarration: ELEVENLABS_API_KEY is not set.");
    return { ok: false, failureCode: "INTERNAL", retryable: false };
  }

  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/v1/text-to-speech/${encodeURIComponent(input.providerVoiceId)}/with-timestamps`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        // AC 12, exactly: text, model id, output format. Nothing else — no
        // profile id, no lesson id, no display name, no filename.
        body: JSON.stringify({
          text: input.text,
          model_id: input.modelId,
          output_format: input.outputFormat,
        }),
        signal: opts?.signal,
      },
    );
  } catch (err) {
    // Network failure or abort. Never `console.error(err)` here — some
    // runtimes attach request context to a fetch AbortError, and this
    // request body describes a child's homework.
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, failureCode: "TIMEOUT", retryable: true };
    }
    console.error("synthesizeNarration: network failure calling the narration vendor.");
    return { ok: false, failureCode: "UPSTREAM", retryable: true };
  }

  if (response.status === 429) {
    // AC 9's backoff target. Never log the body: a 429 body can echo the
    // text we sent, which is a description of a child's homework.
    return { ok: false, failureCode: "RATE_LIMITED", retryable: true };
  }
  if (!response.ok) {
    // A 5xx is worth a retry; any other 4xx (a bad voice id, a malformed
    // request) will not change on retry and would only burn the attempt
    // budget. Never logs the body, for the same reason as above.
    return { ok: false, failureCode: "UPSTREAM", retryable: response.status >= 500 };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failureCode: "UPSTREAM", retryable: true };
  }

  const parsed = SpeechResponseSchema.safeParse(body);
  if (!parsed.success) {
    // The vendor returned 200 with a shape we don't recognise. Retrying a
    // schema mismatch does not help; this is a data-shape problem, not a
    // transient one.
    return { ok: false, failureCode: "UPSTREAM", retryable: false };
  }

  return {
    ok: true,
    audio: base64ToArrayBuffer(parsed.data.audio_base64),
    alignment: {
      characters: parsed.data.alignment.characters,
      characterStartTimesSeconds: parsed.data.alignment.character_start_times_seconds,
      characterEndTimesSeconds: parsed.data.alignment.character_end_times_seconds,
    },
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
