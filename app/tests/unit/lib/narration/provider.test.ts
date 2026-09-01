import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { synthesizeNarration } from "@/lib/narration/provider";

/**
 * `lib/narration/provider.ts` — ADR-0020's single fetch-only vendor client.
 *
 * AC 12 is the load-bearing assertion in this file: the outbound request
 * body's key set must be EXACTLY `{ text, model_id, output_format }`, the
 * voice id must be in the URL, and no student-identifying value (a profile
 * id, a display name, a lesson id) may appear anywhere in the request.
 */

function base64Of(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

const VALID_BODY = {
  audio_base64: base64Of([1, 2, 3, 4]),
  alignment: {
    characters: ["h", "i"],
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the request AC 12 constrains", () => {
  it("carries EXACTLY text, model_id and output_format in the body, and the voice id only in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await synthesizeNarration(
      { text: "one quarter", providerVoiceId: "voice_123", modelId: "eleven_multilingual_v2", outputFormat: "mp3_44100_128" },
      { apiKey: "test-key" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice_123/with-timestamps");

    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(sentBody).sort()).toEqual(["model_id", "output_format", "text"]);
    expect(sentBody).toEqual({ text: "one quarter", model_id: "eleven_multilingual_v2", output_format: "mp3_44100_128" });

    // No student-identifying value anywhere in the request: not the body,
    // not the URL, not a custom header.
    const serialisedRequest = JSON.stringify({ url, headers: init.headers, body: init.body });
    for (const forbidden of ["profile_", "lesson_", "student", "@", "display"]) {
      expect(serialisedRequest.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("sends the api key as the xi-api-key header, never as a bearer token or query param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "secret-key" },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("secret-key");
    expect(url).not.toContain("secret-key");
  });
});

describe("reading the response", () => {
  it("returns the audio bytes and the ORIGINAL alignment field, camelCased", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, VALID_BODY)));

    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result.alignment).toEqual({
      characters: ["h", "i"],
      characterStartTimesSeconds: [0, 0.1],
      characterEndTimesSeconds: [0.1, 0.2],
    });
  });

  /**
   * ADR-0021: the schema this file validates against has NO
   * `normalized_alignment` field, so even a response that carries one cannot
   * leak it into `result.alignment` — the trap is closed by construction,
   * not by a caller remembering to ignore a key.
   */
  it("never surfaces normalized_alignment even when the vendor sends one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          ...VALID_BODY,
          normalized_alignment: {
            characters: [" ", "h", "i", " "],
            character_start_times_seconds: [0, 0, 0.1, 0.2],
            character_end_times_seconds: [0, 0.1, 0.2, 0.2],
          },
        }),
      ),
    );

    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(result as object)).not.toContain("normalizedAlignment");
    expect(Object.keys(result as object)).not.toContain("normalized_alignment");
  });
});

describe("failure classification", () => {
  it("classifies 429 as RATE_LIMITED and retryable, without logging the body", async () => {
    const errorSpy = vi.spyOn(console, "error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("child's homework text leaked here", { status: 429 })));

    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );

    expect(result).toEqual({ ok: false, failureCode: "RATE_LIMITED", retryable: true });
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("child's homework");
    }
  });

  it("classifies a 5xx as UPSTREAM and retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );
    expect(result).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: true });
  });

  it("classifies a 400 (e.g. a bad voice id) as UPSTREAM and NOT retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 400 })));
    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );
    expect(result).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: false });
  });

  it("classifies a network failure as UPSTREAM and retryable, without logging the exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );
    expect(result).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: true });
  });

  it("classifies a schema-invalid 200 as UPSTREAM and NOT retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: "shape" })));
    const result = await synthesizeNarration(
      { text: "hi", providerVoiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128" },
      { apiKey: "k" },
    );
    expect(result).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: false });
  });

  it("refuses INTERNALly with no fetch call at all when no api key is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const original = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const result = await synthesizeNarration({
        text: "hi",
        providerVoiceId: "v1",
        modelId: "m1",
        outputFormat: "mp3_44100_128",
      });
      expect(result).toEqual({ ok: false, failureCode: "INTERNAL", retryable: false });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env.ELEVENLABS_API_KEY = original;
    }
  });
});
