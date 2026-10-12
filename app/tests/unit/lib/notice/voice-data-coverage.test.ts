import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DIRECT_NOTICE_COPY, DIRECT_NOTICE_VERSION } from "@/lib/notice/copy";
import { RETENTION_POLICY } from "@/lib/config";

/**
 * **M6 §2.3 — the notice must describe VOICE data, not only name the vendor.**
 *
 * `third-party-coverage.test.ts` cannot catch this. ElevenLabs was already named
 * when M5 shipped, so M6 sends a new CATEGORY of data (an adult's voice) to a
 * processor the vendor test considers fully covered. Without this, the notice
 * would go on describing narration text only while the app uploads recordings
 * of a real person's voice — the M5 vendor omission again, one level down.
 *
 * Same technique as its sibling: read the SOURCE for the thing that sends the
 * data, and fail when a public surface does not account for it.
 */
describe("the notice and privacy policy describe the voice data M6 sends", () => {
  const repoRoot = process.cwd();
  const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

  const noticeText = [
    ...DIRECT_NOTICE_COPY.uses,
    ...DIRECT_NOTICE_COPY.thirdParties.map((party) => `${party.name} ${party.receives}`),
  ]
    .join("\n")
    .toLowerCase();

  it("finds the voice-clone upload it is guarding (the check is not vacuous)", () => {
    const provider = read("lib/voice/provider.ts");
    expect(provider).toContain("api.elevenlabs.io");
    expect(provider).toMatch(/voices\/add/);
  });

  it("the direct notice says the account holder's own voice recording goes to ElevenLabs", () => {
    const elevenLabs = DIRECT_NOTICE_COPY.thirdParties.find((party) => party.name === "ElevenLabs");
    expect(elevenLabs, "ElevenLabs must stay named").toBeDefined();
    expect(elevenLabs!.receives.toLowerCase()).toMatch(/own voice/);
    expect(elevenLabs!.receives.toLowerCase()).toMatch(/recording/);
  });

  it("the direct notice says what happens to that recording and to children's awareness of it", () => {
    expect(noticeText).toMatch(/deleted/);
    expect(noticeText).toMatch(/recreation/);
  });

  it("the notice says the spoken permission is not sent to the vendor", () => {
    expect(noticeText).toMatch(/never receives the separate recording/);
  });

  it("the privacy page describes the same voice data and its deletion", () => {
    const privacy = read("app/privacy/page.tsx").toLowerCase();
    expect(privacy).toMatch(/add their own voice/);
    expect(privacy).toMatch(/recording of that adult/);
    expect(privacy).toMatch(/never sent to elevenlabs/);
    expect(privacy).toMatch(/removes it from elevenlabs/);
    expect(privacy).toMatch(/recreation/);
  });

  it("every voice retention category is classified, so the retention page cannot omit one", () => {
    const keys = RETENTION_POLICY.map((row) => row.key);
    expect(keys).toContain("VOICE_SAMPLE");
    expect(keys).toContain("VOICE_CONSENT_RECORDING");
    const retentionPage = read("app/retention/page.tsx");
    expect(retentionPage).toContain("VOICE_SAMPLE");
    expect(retentionPage).toContain("VOICE_CONSENT_RECORDING");
  });

  it("the notice version was bumped for the voice change", () => {
    expect(DIRECT_NOTICE_VERSION).not.toBe("2026-09-02.1");
    expect(DIRECT_NOTICE_COPY.version).toBe(DIRECT_NOTICE_VERSION);
  });
});
