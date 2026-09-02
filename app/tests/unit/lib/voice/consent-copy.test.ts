import { describe, expect, it } from "vitest";

import {
  VOICE_CONSENT_APP_NAME,
  VOICE_CONSENT_CLAUSE_RATIONALE,
  VOICE_CONSENT_LINES,
  VOICE_CONSENT_TEXT,
  VOICE_CONSENT_WORDING_VERSION,
} from "@/lib/voice/consent-copy";

/**
 * `lib/voice/consent-copy.ts` — M6 AC 5. Guards on the spoken statement itself.
 *
 * The wording is the artifact this milestone produces; every recording is
 * evidence of these exact words. Review discipline is what the file asks for,
 * but review is what missed four defects in slices 2 and 4. These are the two
 * properties worth asserting mechanically, because both are silent when broken:
 * a paraphrased industry-standard line still reads fine, and a named vendor
 * still reads fine — right up until the vendor changes and every stored consent
 * is arguably stale.
 */
describe("the spoken consent statement", () => {
  it("quotes Microsoft's published Azure custom-voice statement verbatim as line 1", () => {
    // Adopted from
    // learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-consent
    // with the company name filled in, which is that statement's intended use.
    // If this fails, someone paraphrased the one line in the file that is NOT
    // ours to reword. Restore it rather than updating the expectation.
    expect(VOICE_CONSENT_LINES[0]).toBe(
      `I [full name] am aware that recordings of my voice will be used by ${VOICE_CONSENT_APP_NAME} to create and use a synthetic version of my voice.`,
    );
  });

  it("never names the speech vendor, so a vendor change cannot invalidate stored consent", () => {
    // The §312.4 written notice names the vendor. The spoken statement must not:
    // see the file's "Two decisions in the wording" block.
    for (const vendor of ["ElevenLabs", "Eleven Labs", "elevenlabs"]) {
      expect(VOICE_CONSENT_TEXT).not.toContain(vendor);
    }
    expect(VOICE_CONSENT_TEXT).toContain(`${VOICE_CONSENT_APP_NAME}'s speech provider`);
  });

  it("still carries the clauses Microsoft's line does not cover", () => {
    // Microsoft's statement establishes identity and awareness of synthesis. It
    // does not establish adulthood, ownership of the voice, the limit on use, or
    // revocability — and those are the clauses this product needs. Asserted as
    // substrings so the wording can be improved without breaking the test, while
    // silently DROPPING a clause cannot pass.
    expect(VOICE_CONSENT_TEXT).toContain("eighteen or older");
    expect(VOICE_CONSENT_TEXT).toContain("This is my own voice");
    expect(VOICE_CONSENT_TEXT).toContain("of my own free will");
    expect(VOICE_CONSENT_TEXT).toContain("only to read lessons aloud");
    expect(VOICE_CONSENT_TEXT).toContain("withdraw this permission");
  });

  it("speaks the reader's own name and the date, rather than interpolating them", () => {
    expect(VOICE_CONSENT_TEXT).toContain("[full name]");
    expect(VOICE_CONSENT_TEXT).toContain("[date]");
  });

  it("versions the wording in a form the notice copy also uses", () => {
    expect(VOICE_CONSENT_WORDING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("documents every line it asks a parent to say", () => {
    // Not a formatting rule — the rationale list is how the next person to edit
    // the wording learns what each clause is load-bearing for. A line added
    // without one is a line that gets removed later as boilerplate.
    expect(VOICE_CONSENT_CLAUSE_RATIONALE).toHaveLength(VOICE_CONSENT_LINES.length);
    for (const { line, why } of VOICE_CONSENT_CLAUSE_RATIONALE) {
      expect(line.trim()).not.toBe("");
      expect(why.trim()).not.toBe("");
    }
    for (const line of VOICE_CONSENT_LINES) {
      expect(line.trim()).not.toBe("");
    }
  });
});
