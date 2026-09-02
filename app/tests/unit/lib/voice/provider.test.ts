import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVoice, deleteVoice, resolveVoiceAdminKey } from "@/lib/voice/provider";
import { vendorSampleFilename, vendorVoiceName, isAcceptedVoiceContentType } from "@/lib/voice/naming";

/**
 * `lib/voice/provider.ts` — the only file that creates or deletes a voice at the
 * vendor. Every response shape asserted here was OBSERVED in the 2026-09-02
 * measurement (`docs/research/m6-voice-clone-measurement.md`) rather than
 * assumed from documentation: retro lesson 18 says an ADR's claims about a
 * vendor are hypotheses, and three of M3's were false.
 *
 * `fetch` is stubbed rather than the module mocked, so the request this file
 * actually builds — its URL, headers and multipart body — is what gets asserted.
 * Mocking a wrapper would test the wrapper.
 */

const ORIGINAL_ENV = { ...process.env };

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE = new Uint8Array([1, 2, 3, 4]).buffer;

function createInput(overrides: Partial<Parameters<typeof createVoice>[0]> = {}) {
  return {
    name: vendorVoiceName("cv_abc123"),
    sample: SAMPLE,
    sampleContentType: "audio/webm",
    sampleFilename: vendorSampleFilename("audio/webm"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.ELEVENLABS_API_KEY = "narration-key";
  delete process.env.ELEVENLABS_VOICE_ADMIN_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("which credential this file uses", () => {
  it("prefers the admin key when one is set", () => {
    process.env.ELEVENLABS_VOICE_ADMIN_KEY = "admin-key";
    expect(resolveVoiceAdminKey()).toBe("admin-key");
  });

  it("falls back to the narration key so one key still works today", () => {
    expect(resolveVoiceAdminKey()).toBe("narration-key");
  });

  it("treats an empty admin key as unset rather than as a credential", () => {
    // An empty env var is how a half-finished deployment presents itself, and
    // sending `xi-api-key: ""` would produce a confusing 401 rather than the
    // fallback the operator expected.
    process.env.ELEVENLABS_VOICE_ADMIN_KEY = "";
    expect(resolveVoiceAdminKey()).toBe("narration-key");
  });

  it("sends the admin key on the wire when present", async () => {
    process.env.ELEVENLABS_VOICE_ADMIN_KEY = "admin-key";
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "v1" }));

    await createVoice(createInput());

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("admin-key");
  });

  it("refuses, without calling the vendor, when no key is configured at all", async () => {
    delete process.env.ELEVENLABS_API_KEY;

    const result = await createVoice(createInput());

    expect(result).toEqual({ ok: false, failureCode: "INTERNAL", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createVoice — what reaches the vendor", () => {
  it("posts to /v1/voices/add with exactly `name` and `files`", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "v1" }));

    await createVoice(createInput());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect(init.method).toBe("POST");

    // The exact key set. A profile id, a lesson id, an email or a child's name
    // appearing here is the failure this assertion exists to catch — the same
    // shape as M5 AC 12's request-body test, for more sensitive data.
    const form = init.body as FormData;
    expect([...form.keys()].sort()).toEqual(["files", "name"]);
  });

  it("never sets content-type by hand, so fetch can write the multipart boundary", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "v1" }));

    await createVoice(createInput());

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(["xi-api-key"]);
  });

  it("sends an opaque account-scoped name, never a person's", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "v1" }));

    await createVoice(createInput());

    const form = fetchMock.mock.calls[0][1].body as FormData;
    const name = form.get("name") as string;
    expect(name).toBe("m6-cv_abc123");
    // Nothing human-readable about the speaker. `vendorVoiceName` takes an id
    // precisely so a label can never be passed here by accident.
    expect(name).not.toMatch(/@/);
  });

  it("returns the voice id and requiresVerification: false, as measured", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "hCfzmATMP6ogo3lrb0dH", requires_verification: false }));

    const result = await createVoice(createInput());

    expect(result).toEqual({ ok: true, providerVoiceId: "hCfzmATMP6ogo3lrb0dH", requiresVerification: false });
  });

  it("carries requiresVerification through when the vendor DOES ask for it (AC 13)", async () => {
    // Never observed in the measurement, which is why AC 13 is a defensive
    // branch — but a vendor can change this without telling us, and the flow
    // must not present an unusable voice as ready.
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "v1", requires_verification: true }));

    const result = await createVoice(createInput());

    expect(result).toEqual({ ok: true, providerVoiceId: "v1", requiresVerification: true });
  });

  it("treats a missing requires_verification as false rather than crashing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ voice_id: "v1" }));

    const result = await createVoice(createInput());

    expect(result).toMatchObject({ ok: true, requiresVerification: false });
  });
});

describe("createVoice — failures", () => {
  it("classifies 401/403 as UNAUTHORIZED and does not ask for a retry", async () => {
    // The most likely real cause is `voices_write` missing from whichever key
    // was resolved. No retry can fix a permission.
    for (const status of [401, 403]) {
      fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, status));
      const result = await createVoice(createInput());
      expect(result).toEqual({ ok: false, failureCode: "UNAUTHORIZED", retryable: false });
    }
  });

  it("classifies 422 as QUOTA, separately from UPSTREAM", async () => {
    // "No voice slots left" is the one failure a parent can do nothing about and
    // we can. It is also the signal that answers the spec's still-open
    // voice-cap question, so it must not be hidden inside UPSTREAM.
    fetchMock.mockResolvedValue(jsonResponse({ detail: [] }, 422));

    const result = await createVoice(createInput());

    expect(result).toEqual({ ok: false, failureCode: "QUOTA", retryable: false });
  });

  it("classifies 429 as RATE_LIMITED and retryable", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    expect(await createVoice(createInput())).toEqual({ ok: false, failureCode: "RATE_LIMITED", retryable: true });
  });

  it("retries a 5xx but not an unclassified 4xx", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    expect(await createVoice(createInput())).toMatchObject({ failureCode: "UPSTREAM", retryable: true });

    fetchMock.mockResolvedValue(jsonResponse({}, 418));
    expect(await createVoice(createInput())).toMatchObject({ failureCode: "UPSTREAM", retryable: false });
  });

  it("maps an abort to TIMEOUT", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    expect(await createVoice(createInput())).toEqual({ ok: false, failureCode: "TIMEOUT", retryable: true });
  });

  /**
   * The worst case in this file: the vendor took the sample, made a voice, and
   * told us in a shape we cannot read. A voice of a real person now exists that
   * we have no id for and therefore cannot delete.
   */
  it("does NOT ask for a retry on an unreadable 200 — a second attempt would clone twice", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    expect(await createVoice(createInput())).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: false });

    fetchMock.mockResolvedValue(jsonResponse({ unexpected: "shape" }));
    expect(await createVoice(createInput())).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: false });
  });

  it("never logs a response body or an error object", async () => {
    const errorSpy = vi.spyOn(console, "error");
    fetchMock.mockResolvedValue(jsonResponse({ detail: "SECRET-BODY-CONTENT" }, 500));

    await createVoice(createInput());

    for (const call of errorSpy.mock.calls) {
      const logged = call.map(String).join(" ");
      expect(logged).not.toContain("SECRET-BODY-CONTENT");
    }
  });
});

describe("deleteVoice — AC 19/20", () => {
  it("DELETEs the voice by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));

    const result = await deleteVoice("hCfzmATMP6ogo3lrb0dH");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/voices/hCfzmATMP6ogo3lrb0dH");
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ ok: true, alreadyGone: false });
  });

  it("url-encodes the id rather than interpolating it raw", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));
    await deleteVoice("a/b?c");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.elevenlabs.io/v1/voices/a%2Fb%3Fc");
  });

  /**
   * The measurement's own bug, as a test. This vendor says "gone" with HTTP 400
   * and a typed `voice_not_found` body, NOT a 404 — the measurement's first run
   * reported a genuinely successful deletion as UNCERTAIN because it keyed on
   * the status alone.
   */
  it("treats the vendor's 400 + voice_not_found as SUCCESS, already gone", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: { type: "not_found", code: "voice_not_found", status: "voice_not_found" } }, 400),
    );

    expect(await deleteVoice("v1")).toEqual({ ok: true, alreadyGone: true });
  });

  it("treats a 404 as already gone too, in case the vendor ever changes its mind", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "missing" }, 404));
    expect(await deleteVoice("v1")).toEqual({ ok: true, alreadyGone: true });
  });

  it("does NOT treat any other 400 as gone", async () => {
    // A malformed request must not be reported as a successful deletion — that
    // would write a "deleted" audit row for a voice still sitting at the vendor.
    fetchMock.mockResolvedValue(jsonResponse({ detail: { status: "something_else" } }, 400));
    expect(await deleteVoice("v1")).toMatchObject({ ok: false, failureCode: "UPSTREAM" });
  });

  it("reports UNAUTHORIZED rather than success when the key cannot delete", async () => {
    // Reporting this as success is how a voice model of a real person survives
    // at a vendor after its owner was told it was deleted.
    fetchMock.mockResolvedValue(jsonResponse({ detail: "missing permission" }, 401));
    expect(await deleteVoice("v1")).toEqual({ ok: false, failureCode: "UNAUTHORIZED", retryable: false });
  });

  it("maps a network failure to a retryable UPSTREAM", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    expect(await deleteVoice("v1")).toEqual({ ok: false, failureCode: "UPSTREAM", retryable: true });
  });
});

describe("what the vendor is allowed to see (naming)", () => {
  it("builds a name from our id, with nothing human in it", () => {
    expect(vendorVoiceName("cv_123")).toBe("m6-cv_123");
  });

  it("uses a generic sample filename, never the parent's own", () => {
    // A phone recording is routinely named "Sarah's voice memo.m4a".
    expect(vendorSampleFilename("audio/webm")).toBe("sample.webm");
    expect(vendorSampleFilename("audio/mp4")).toBe("sample.m4a");
    expect(vendorSampleFilename("audio/mpeg;codecs=mp3")).toBe("sample.mp3");
  });

  it("falls back to an obviously-wrong extension rather than throwing", () => {
    expect(vendorSampleFilename("application/octet-stream")).toBe("sample.bin");
  });

  it("accepts what browsers actually record, across engines", () => {
    // Chrome/Firefox produce webm; Safari produces mp4. Rejecting either would
    // make the feature silently browser-specific.
    expect(isAcceptedVoiceContentType("audio/webm")).toBe(true);
    expect(isAcceptedVoiceContentType("audio/mp4")).toBe(true);
    expect(isAcceptedVoiceContentType("audio/webm;codecs=opus")).toBe(true);
    expect(isAcceptedVoiceContentType("video/mp4")).toBe(false);
    expect(isAcceptedVoiceContentType("application/json")).toBe(false);
  });
});
