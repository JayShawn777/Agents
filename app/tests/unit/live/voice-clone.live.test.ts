import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * **M6's gating measurement.** Skipped unless ALL THREE of these hold, so a
 * normal `pnpm test` costs nothing and can never create a voice by accident:
 *
 *   1. `RUN_LIVE_AI=1`                    — the project's live-call convention
 *   2. `ELEVENLABS_API_KEY` set           — and it needs WRITE scope, see below
 *   3. `M6_VOICE_CONSENT=1`               — an explicit, separate opt-in
 *   4. a sample at `.scratch/m6-voice-sample.<ext>` — mp3, m4a, wav, webm,
 *      ogg, flac, mp4 or aac, whichever your recorder produced
 *
 *   RUN_LIVE_AI=1 M6_VOICE_CONSENT=1 pnpm vitest run \
 *     tests/unit/live/voice-clone.live.test.ts --project unit
 *
 * **Why a FOURTH gate that no other live test has.** Every other measurement in
 * this directory spends a few cents and reads some text back. This one creates a
 * model of a real human being's voice inside a third party's system, and that
 * model persists there until something deletes it. `RUN_LIVE_AI=1` is a
 * convention about cost; it is not consent to clone somebody. `M6_VOICE_CONSENT=1`
 * is the runner asserting, deliberately and separately, that the sample at that
 * path is **their own voice** and that they consent to it being sent.
 *
 * That is the same ethic M6 itself is built on (AC 4: recorded live, in-app, by
 * the signed-in account owner; no file-upload path, "not as a convenience, not
 * as a fallback, not for support cases"). A measurement that violated the
 * milestone's own rule in order to test it would be an odd way to begin.
 *
 * **The sample must be the runner's own voice.** There is no way to measure
 * voice cloning without cloning a voice, and the spec's non-goals bar using
 * anyone else's — not a family member, not a public figure, not a clip from a
 * video. `.scratch/` is gitignored; the sample must never reach the repository.
 *
 * ## What this answers, and why it must run BEFORE the architect
 *
 * The M6 spec names one open question as **BLOCKING for the design**, and the
 * research calls it the highest-risk unknown in the whole integration:
 *
 *   **"Is a voice created through the API immediately usable, or blocked
 *   pending a manual verification step?"** If a human has to complete a captcha
 *   in the vendor's own dashboard, the parent-facing flow as specified does not
 *   work and M6 needs rethinking. The spec's AC 13 makes the pending case
 *   survivable rather than assuming it away — but "survivable" and "the normal
 *   path" are different designs.
 *
 * A second question is blocking for scale rather than for a first build:
 * **how many cloned voices does the plan allow, and is the cap per account or
 * account-wide?** If it is low and account-wide it is a hard ceiling on how many
 * families can ever use this feature.
 *
 * This is M4's §9.2 pattern and M5's vendor measurement applied a third time.
 * Four of M4's five measurements changed the design; M5's flipped an assumption
 * about which model supports timestamps. Retro lesson 18: an ADR's claims about
 * a vendor are hypotheses, not decisions.
 *
 * **It uses `fetch` and adds NO dependency**, deliberately — same reasoning as
 * M5's. If the answers come back wrong, nothing will have been installed.
 *
 * ## What the key actually has — MEASURED 2026-09-02, not assumed
 *
 * This section previously said the key lacked `voices_write` and that M6 would
 * need a second one. The read-only probes below were then run, and said
 * otherwise:
 *
 *   - `voices_read`   YES — 21 voices listed.
 *   - `user_read`     NO  — explicit 401, "missing the permission user_read".
 *                           So the voice-CAP question stays unanswerable with
 *                           this key. Blocking for scale, not for a first build.
 *   - `voices_write`  YES — `POST /v1/voices/add` returns 422 `Field required`
 *                           for a malformed body, NOT the 401 the same API
 *                           returns for an absent scope. Both failure modes
 *                           appeared in one run, which is what makes this an
 *                           inference rather than a guess.
 *
 * `app/CLAUDE.md` claimed `voices_read` + `text_to_speech` "only" and has been
 * corrected. Worth an owner decision, flagged there rather than silently acted
 * on: the everyday synthesis key can create AND DELETE every voice on the
 * account, which nobody chose.
 *
 * The probes are ordered so the read-only ones run first and record what the key
 * can and cannot do; a 401 is a RESULT, written to the report, not a failure.
 *
 * Results are written to `.scratch/` (gitignored) for the research note.
 */

const LIVE = process.env.RUN_LIVE_AI === "1";
const KEY = process.env.ELEVENLABS_API_KEY ?? "";
const CONSENTED = process.env.M6_VOICE_CONSENT === "1";

/**
 * The sample, in whatever format the recorder produced. Phones and desktop
 * recorders disagree — iPhone Voice Memos and Windows Voice Recorder both give
 * `.m4a`, Android varies, browser recorders give `.webm`. Requiring one specific
 * extension would mean asking the owner to install a converter to answer a
 * yes/no question, so the harness takes the first one it finds instead.
 */
const SAMPLE_CANDIDATES = [
  ".scratch/m6-voice-sample.mp3",
  ".scratch/m6-voice-sample.m4a",
  ".scratch/m6-voice-sample.wav",
  ".scratch/m6-voice-sample.webm",
  ".scratch/m6-voice-sample.ogg",
  ".scratch/m6-voice-sample.flac",
  ".scratch/m6-voice-sample.mp4",
  ".scratch/m6-voice-sample.aac",
];

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

function findSample(): string | null {
  return SAMPLE_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

const SAMPLE_PATH = findSample();

const API = "https://api.elevenlabs.io";

/** Read-only probes need no sample and no consent gate — they create nothing. */
const READ_ENABLED = LIVE && KEY.length > 0;
/** Write probes additionally need the explicit consent gate and a real sample. */
const WRITE_ENABLED = READ_ENABLED && CONSENTED && SAMPLE_PATH !== null;

type Finding = { question: string; answer: string; detail?: unknown };
const findings: Finding[] = [];

function record(question: string, answer: string, detail?: unknown): void {
  findings.push({ question, answer, detail });
  // Printed as it happens: a run that dies partway is still worth what it got.
  console.log(`\n[M6] ${question}\n     -> ${answer}`);
}

function writeReport(): void {
  mkdirSync(".scratch", { recursive: true });
  writeFileSync(".scratch/m6-voice-clone-measurement.json", JSON.stringify(findings, null, 2));
}

async function call(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; ok: boolean; json: unknown; text: string }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": KEY, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (audio, or an HTML error page) — `text` is the record */
  }
  return { status: res.status, ok: res.ok, json, text };
}

describe.skipIf(!READ_ENABLED)("M6 measurement — what the current key can see", () => {
  it("records whether the key can list voices at all (voices_read)", async () => {
    const res = await call("/v1/voices");
    record(
      "Can this key list voices (voices_read)?",
      res.ok ? "YES" : `NO — HTTP ${res.status}`,
      res.ok ? { count: (res.json as { voices?: unknown[] })?.voices?.length ?? 0 } : res.text.slice(0, 400),
    );
    // Recorded, not asserted: a "no" here is a finding about key scope, and the
    // run should continue to establish exactly which scopes are missing.
    expect(res.status).toBeGreaterThan(0);
  });

  it("records whether the key can read the subscription (user_read) — the voice-cap question", async () => {
    const res = await call("/v1/user/subscription");
    if (res.ok) {
      const sub = res.json as Record<string, unknown>;
      record("How many cloned voices does this plan allow?", "READ SUCCESSFULLY", {
        tier: sub.tier,
        voice_limit: sub.voice_limit,
        voice_slots_used: sub.voice_slots_used,
        professional_voice_limit: sub.professional_voice_limit,
        can_use_instant_voice_cloning: sub.can_use_instant_voice_cloning,
        can_use_professional_voice_cloning: sub.can_use_professional_voice_cloning,
        character_limit: sub.character_limit,
      });
    } else {
      record(
        "How many cloned voices does this plan allow?",
        `UNANSWERED — HTTP ${res.status}. The key has no \`user_read\` scope, which is deliberate ` +
          `(app/CLAUDE.md). Answering the voice-cap question requires the owner to widen the scope ` +
          `or issue a second key.`,
        res.text.slice(0, 400),
      );
    }
    expect(res.status).toBeGreaterThan(0);
  });

  it("records whether the key can WRITE voices — the scope M6 actually needs", async () => {
    // A deliberately malformed create: it cannot succeed, so it creates nothing,
    // but the status distinguishes "no permission" (401/403) from "bad request"
    // (422), which is exactly the scope question and costs nothing either way.
    const res = await call("/v1/voices/add", { method: "POST", body: new FormData() });
    const scoped = res.status === 401 || res.status === 403;
    record(
      "Does this key have `voices_write`, which creating a voice requires?",
      scoped
        ? `NO — HTTP ${res.status}. M6 cannot be measured or built until the owner widens the key scope ` +
            `or issues a second, write-scoped key.`
        : `PROBABLY YES — HTTP ${res.status} (a validation error, not a permission error).`,
      res.text.slice(0, 400),
    );
    expect(res.status).toBeGreaterThan(0);
  });
});

describe.skipIf(!WRITE_ENABLED)("M6 measurement — the BLOCKING question, with a real sample", () => {
  let createdVoiceId: string | null = null;

  it("creates a voice from the sample, and records whether it is usable IMMEDIATELY", async () => {
    const samplePath = SAMPLE_PATH as string;
    const sample = readFileSync(samplePath);
    const ext = samplePath.split(".").pop() ?? "mp3";
    const mime = MIME_BY_EXT[ext] ?? "audio/mpeg";
    record("Which sample file was used?", samplePath, { bytes: sample.length, mime });

    const form = new FormData();
    form.append("name", `m6-measurement-${Date.now()}`);
    form.append("files", new Blob([new Uint8Array(sample)], { type: mime }), `sample.${ext}`);
    form.append("description", "Temporary voice created by M6's gating measurement. Deleted by the same run.");

    const created = await call("/v1/voices/add", { method: "POST", body: form });
    if (!created.ok) {
      record(
        "BLOCKING: is an API-created voice immediately usable?",
        `COULD NOT CREATE — HTTP ${created.status}. This is itself the answer if it is a permission or ` +
          `verification error; read the detail before concluding anything about the design.`,
        created.text.slice(0, 600),
      );
      return;
    }

    const body = created.json as Record<string, unknown>;
    createdVoiceId = (body.voice_id as string) ?? null;
    record("Was the voice created at all?", `YES — voice_id ${createdVoiceId}`, body);

    // The real question: can it SYNTHESIZE right now, with no dashboard step?
    const tts = await call(`/v1/text-to-speech/${createdVoiceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "The bottom number counts the pieces, so it does not change.",
        model_id: "eleven_multilingual_v2",
      }),
    });
    record(
      "BLOCKING: is an API-created voice immediately usable, or pending manual verification?",
      tts.ok
        ? "IMMEDIATELY USABLE — synthesis succeeded with no dashboard step. The parent-facing flow as " +
            "specified works, and AC 13's pending state is a defensive branch rather than the normal path."
        : `NOT IMMEDIATELY USABLE — HTTP ${tts.status}. M6's design needs rethinking; AC 13's pending ` +
            `state becomes the normal path, not an edge case.`,
      tts.ok ? { audioBytes: tts.text.length } : tts.text.slice(0, 600),
    );
    expect(created.status).toBeGreaterThan(0);
  });

  it("records what the voice row reports about its own verification state", async () => {
    if (!createdVoiceId) {
      record("What does the created voice report about verification?", "SKIPPED — no voice was created.");
      return;
    }
    const res = await call(`/v1/voices/${createdVoiceId}`);
    const body = res.json as Record<string, unknown>;
    record(
      "What does the created voice report about verification?",
      res.ok ? "READ SUCCESSFULLY" : `HTTP ${res.status}`,
      res.ok ? { category: body.category, fine_tuning: body.fine_tuning, safety_control: body.safety_control } : res.text.slice(0, 400),
    );
    expect(res.status).toBeGreaterThan(0);
  });

  /**
   * AC 19 and AC 20 are written as VENDOR-SIDE deletions, because a voice model
   * persists in someone else's system until something removes it. This both
   * cleans up after the measurement and establishes that the deletion path M6
   * depends on actually works — worth knowing before designing around it.
   */
  it("deletes the voice, and records whether vendor-side deletion actually works (AC 19/20)", async () => {
    if (!createdVoiceId) {
      record("Does vendor-side deletion work?", "SKIPPED — no voice was created.");
      return;
    }
    const del = await call(`/v1/voices/${createdVoiceId}`, { method: "DELETE" });
    const after = await call(`/v1/voices/${createdVoiceId}`);
    record(
      "Does vendor-side deletion actually remove the voice (AC 19/20)?",
      del.ok && after.status === 404
        ? "YES — deleted, and a subsequent read is 404."
        : `UNCERTAIN — delete HTTP ${del.status}, follow-up read HTTP ${after.status}. ` +
            `M6 cannot promise "delete means delete" until this is understood.`,
      { deleteBody: del.text.slice(0, 300), readAfter: after.text.slice(0, 300) },
    );

    // Loud, because a leaked voice model of a real person is the worst possible
    // residue of a test run.
    if (!del.ok) {
      console.error(
        `\n[M6] !!! A voice (${createdVoiceId}) may still exist at the vendor. Delete it manually. !!!\n`,
      );
    }
    expect(del.status).toBeGreaterThan(0);
  });

  it("writes the report", () => {
    writeReport();
    expect(findings.length).toBeGreaterThan(0);
  });
});

/**
 * Runs even when everything above is skipped, so an inert run still explains
 * itself rather than reporting a silent pass — the same "a skip must say why"
 * discipline as M4's legibility spec and M5's slice 12 note.
 */
describe("M6 measurement — preconditions", () => {
  it("states exactly what is missing before it can run", () => {
    const missing: string[] = [];
    if (!LIVE) missing.push("RUN_LIVE_AI=1");
    if (KEY.length === 0) missing.push("ELEVENLABS_API_KEY");
    if (!CONSENTED) missing.push("M6_VOICE_CONSENT=1 (asserts the sample is YOUR OWN voice)");
    if (SAMPLE_PATH === null) {
      missing.push(`a voice sample at .scratch/m6-voice-sample.<mp3|m4a|wav|webm|ogg|flac|mp4|aac>`);
    }

    if (missing.length > 0) {
      console.log(
        `\n[M6] Measurement did not run. Missing: ${missing.join(", ")}.\n` +
          `     This is NOT a failure — it is the gate. See this file's docstring.\n`,
      );
    }
    if (READ_ENABLED) writeReport();
    expect(true).toBe(true);
  });
});
