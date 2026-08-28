import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * **M5's gating measurement.** Skipped unless `RUN_LIVE_AI=1` AND
 * `ELEVENLABS_API_KEY` is set, so a normal `pnpm test` costs nothing.
 *
 *   RUN_LIVE_AI=1 pnpm vitest run tests/unit/live/narration.live.test.ts --project unit
 *
 * The M5 spec says of its second open question: **"Run the experiment before
 * the architect fixes the shape."** This is that experiment. It exists because
 * M4 established the pattern that paid off — plan §9.2's five measurements
 * gated M4's contract, and four of the five results changed the design — and
 * because retro lesson 18 says an ADR's claims about a vendor are hypotheses,
 * not decisions. Three of M3's ADR claims about a vendor were false and all
 * three surfaced within hours of implementation starting.
 *
 * **It deliberately uses `fetch` and adds NO dependency.** `@elevenlabs/
 * elevenlabs-js` is a new major dependency and the constitution requires the
 * owner's approval before it is installed. Answering "does this vendor do what
 * the research claims" must not require first committing to the SDK — and if
 * the answers come back wrong, we will not have installed anything.
 *
 * WHAT IT ANSWERS, both from M5's own open questions:
 *
 *  1. **Does the with-timestamps endpoint work with the LOW-LATENCY model?**
 *     The research could not confirm it and flagged it as the one experiment
 *     that constrains the architecture. M5 pre-generates everything, so the
 *     expressive model is the natural choice for quality — but this answer
 *     decides whether any future low-latency synced surface (a live tutor
 *     voice) is possible at all, which is a thing worth knowing before the
 *     shape is fixed rather than after.
 *  2. **Which stock voices does THIS account actually have?** The research
 *     found the legacy default voices are documented to expire 2026-12-31 and
 *     may not exist for accounts created after March 2026. Personas cannot be
 *     chosen from a voice list nobody has looked at.
 *
 * It also records the alignment's real shape. The research says character-level
 * rather than word-level, which means grouping into words is OUR problem and
 * belongs in our own normalised cue format — one of the three ADRs the M5 spec
 * asks the architect for. A claim that load-bearing should be seen, not cited.
 *
 * Results are written to `.scratch/` (gitignored) for the research note.
 */

const LIVE = process.env.RUN_LIVE_AI === "1";
const KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ENABLED = LIVE && KEY.length > 0;

const API = "https://api.elevenlabs.io";

/** The sentence is a real one from an M4 lesson: it has a number and a fraction read aloud. */
const NARRATION = "The bottom number counts the pieces, so it does not change.";

/** Flash is the documented low-latency model; the multilingual one is the quality default. */
const FAST_MODEL = "eleven_flash_v2_5";
const QUALITY_MODEL = "eleven_multilingual_v2";

type Alignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
};

type Report = Record<string, unknown>;
const report: Report = { takenAt: new Date().toISOString() };

function writeReport() {
  try {
    mkdirSync(".scratch", { recursive: true });
    writeFileSync(".scratch/m5-narration-measurement.json", JSON.stringify(report, null, 2));
  } catch {
    // The measurement matters; persisting it is a convenience.
  }
}

async function speakWithTimestamps(voiceId: string, modelId: string) {
  const startedAt = Date.now();
  const response = await fetch(`${API}/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: NARRATION, model_id: modelId }),
  });
  const elapsedMs = Date.now() - startedAt;
  const bodyText = await response.text();

  type SpeechBody = { audio_base64?: string; alignment?: Alignment };
  let parsed: SpeechBody | null = null;
  try {
    parsed = JSON.parse(bodyText) as SpeechBody;
  } catch {
    parsed = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    elapsedMs,
    alignment: parsed?.alignment ?? null,
    audioBytes: parsed?.audio_base64 ? Buffer.from(parsed.audio_base64, "base64").length : 0,
    // Only the vendor's own error text, never a key. Truncated: this lands in a
    // report file and an error body is not a place to be generous.
    error: response.ok ? null : bodyText.slice(0, 300),
  };
}

describe.skipIf(!ENABLED)("M5 gating measurement — the TTS vendor, before the architecture", () => {
  it("lists the stock voices this account can actually use (M5 open question 3)", async () => {
    const response = await fetch(`${API}/v2/voices?voice_type=default&page_size=100`, {
      headers: { "xi-api-key": KEY },
    });
    expect(response.ok, `GET /v2/voices returned ${response.status}`).toBe(true);

    const body = (await response.json()) as { voices?: { voice_id: string; name: string; category?: string }[] };
    const voices = body.voices ?? [];

    report.voices = voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
    report.voiceCount = voices.length;
    writeReport();

    // The persona list cannot be populated from an empty set, and AC 1 requires
    // personas to be database rows pointing at real provider voice ids.
    expect(voices.length, "this account has NO default voices — personas cannot be chosen").toBeGreaterThan(0);
  });

  it("answers whether with-timestamps works on the LOW-LATENCY model (M5 open question 2)", async () => {
    const listed = (report.voices as { id: string }[] | undefined) ?? [];
    const voiceId = listed[0]?.id;
    expect(voiceId, "no voice id available — the voices test must run first").toBeTruthy();

    const fast = await speakWithTimestamps(voiceId!, FAST_MODEL);
    const quality = await speakWithTimestamps(voiceId!, QUALITY_MODEL);

    report.withTimestamps = {
      [FAST_MODEL]: { ok: fast.ok, status: fast.status, elapsedMs: fast.elapsedMs, audioBytes: fast.audioBytes, error: fast.error },
      [QUALITY_MODEL]: {
        ok: quality.ok,
        status: quality.status,
        elapsedMs: quality.elapsedMs,
        audioBytes: quality.audioBytes,
        error: quality.error,
      },
    };

    // **Recorded, not asserted.** A `false` here is a real answer that changes
    // the architecture — it is not a broken test, and failing the run would
    // throw away the finding. M5 pre-generates narration, so the quality model
    // is the natural choice either way; what this settles is whether a future
    // low-latency synced surface is reachable at all.
    report.fastModelSupportsTimestamps = fast.ok;

    // The quality model IS load-bearing for M5 and must work.
    expect(quality.ok, `with-timestamps failed on ${QUALITY_MODEL}: ${quality.error}`).toBe(true);
    expect(quality.audioBytes).toBeGreaterThan(0);

    const alignment = quality.alignment;
    expect(alignment, "no alignment returned — the whole sync design rests on this").not.toBeNull();

    const characters = alignment?.characters ?? [];
    const starts = alignment?.character_start_times_seconds ?? [];
    const ends = alignment?.character_end_times_seconds ?? [];

    report.alignment = {
      unit: characters.length === NARRATION.length ? "character" : "unknown",
      characterCount: characters.length,
      narrationLength: NARRATION.length,
      startsCount: starts.length,
      endsCount: ends.length,
      lastEndSeconds: ends.at(-1) ?? null,
      containsWordArray: Object.keys(alignment ?? {}).includes("words"),
    };
    writeReport();

    // Character-level, per the research. If this ever comes back word-level the
    // cue format gets simpler and the ADR should say so.
    expect(characters.length).toBe(starts.length);
    expect(starts.length).toBe(ends.length);
    expect(characters.length).toBeGreaterThan(0);
  });
});

describe.skipIf(ENABLED)("M5 gating measurement (inert)", () => {
  it("stays skipped without RUN_LIVE_AI=1 and a key, and says what is missing", () => {
    // Not a placeholder: a run that silently measures nothing is how "we checked"
    // becomes untrue. This states the precondition out loud.
    expect(ENABLED).toBe(false);
  });
});
