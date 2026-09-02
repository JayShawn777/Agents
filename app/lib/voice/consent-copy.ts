/**
 * M6 AC 5. The prescribed consent statement an account owner reads ALOUD before
 * any voice sample is recorded.
 *
 * Versioned exactly like the §312.4 direct notice (`lib/notice/copy.ts`), and
 * for the same reason: the version is stored on every recording, so an existing
 * artifact keeps saying which words were actually read. **Change the wording and
 * bump `VOICE_CONSENT_WORDING_VERSION` in the same diff.** Nothing enforces that
 * mechanically; it is a review discipline, named here so it is not missed.
 *
 * No `server-only` import — this is plain data, and the recording screen is a
 * client component that must display the exact words to read.
 *
 * ## Why the ordering matters, and why this file exists before the sample
 *
 * AC 5 requires the statement to be recorded BEFORE the voice sample, not after.
 * A consent statement obtained once the sample already exists is a formality
 * collected to paper a decision that has been made. Obtained first, it is the
 * gate: the flow cannot proceed without it, and AC 6 refuses creation outright
 * when no recording exists for this account at the current wording version.
 *
 * ## The first line is the industry standard, quoted deliberately
 *
 * Line 1 is Microsoft's published verbal consent statement for Azure custom and
 * personal voice, which ships localized to every supported locale and is the
 * closest thing this field has to a reviewed, off-the-shelf artifact:
 *
 *   "I [state your first and last name] am aware that recordings of my voice
 *    will be used by [state the name of the company] to create and use a
 *    synthetic version of my voice."
 *
 * We keep its structure and wording and fill in the company name, because a
 * reader who has to improvise the company name gets it wrong and the recording
 * then has to be redone. See
 * https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-consent
 *
 * **Researched 2026-09-02, and it changed the shape of this file.** The
 * alternative candidates did not survive: ElevenLabs' "voice captcha" is a
 * random anti-spoofing phrase, not a consent statement, so there is nothing
 * there to adopt; Descript's wording is not published. Microsoft's is the only
 * published, vetted statement — and on its own it is *thinner* than what this
 * product needs, which is why lines 2-6 remain. It establishes identity and
 * awareness of synthesis. It does not establish adulthood, that the speaker owns
 * the voice, what the voice may be used for, who stores it, or that consent can
 * be withdrawn. Those are the clauses this milestone exists for.
 *
 * ## Two decisions in the wording, made deliberately (owner-approved 2026-09-02)
 *
 * **The vendor is NOT named.** The statement says "Homework Helper's speech
 * provider". Naming ElevenLabs here would make every stored recording stale the
 * day the vendor changes, and a version bump would then invalidate consent that
 * is still perfectly valid. The §312.4 written notice names the vendor, which is
 * where an enumeration of processors belongs.
 *
 * **The date is spoken.** It costs a beat of fluency and buys a recording that
 * binds a person to a moment in their own voice. `createdAt` records when we
 * received it; only the speaker can say when they said it.
 *
 * ## Not legal advice
 *
 * Line 1 is Microsoft's; lines 2-6 were drafted here and approved by the owner.
 * Voice cloning touches right-of-publicity law, state biometric statutes
 * (Illinois BIPA, Texas CUBI, Washington MHMD) and the vendor's own terms. **A
 * lawyer should review this before launch.** It is structurally sound — it
 * identifies the speaker, establishes adulthood and ownership, asserts the voice
 * is their own, scopes the permission, discloses third-party storage and states
 * revocability — which is what the build needs. It is not a legal opinion.
 */

/**
 * Bumped to `.2` on 2026-09-02: line 1 was replaced with Microsoft's published
 * statement and line 5 narrowed to scoping (line 1 now covers creation). No
 * recording had been stored against `.1`, so nothing was invalidated — which is
 * exactly why this change was made now rather than after launch.
 */
export const VOICE_CONSENT_WORDING_VERSION = "2026-09-02.2";

/**
 * The product name as it is spoken. Matches `app/layout.tsx`'s metadata title.
 * If the product is ever renamed, this changes and the version bumps with it —
 * a recording naming a product that no longer exists is weaker evidence.
 */
export const VOICE_CONSENT_APP_NAME = "Homework Helper";

/**
 * The statement, as lines. An array rather than one blob so the recording screen
 * can render it as separate paragraphs with breathing room — a wall of text is
 * read badly, and a badly read statement gets re-recorded three times.
 *
 * `[full name]` and `[date]` are spoken substitutions the reader makes aloud.
 * They are deliberately NOT interpolated from account data: the point is that
 * the person says their own name, in their own voice. Pre-filling it would mean
 * the recording proves someone read a screen, not that a named person spoke.
 */
export const VOICE_CONSENT_LINES: readonly string[] = [
  `I [full name] am aware that recordings of my voice will be used by ${VOICE_CONSENT_APP_NAME} to create and use a synthetic version of my voice.`,
  "Today is [date].",
  `I am eighteen or older, and I am the account holder for ${VOICE_CONSENT_APP_NAME}.`,
  "This is my own voice. I am recording this myself, of my own free will.",
  `I give ${VOICE_CONSENT_APP_NAME} permission to use that synthetic version only to read lessons aloud to the children on my account.`,
  `I understand this copy is created and stored by ${VOICE_CONSENT_APP_NAME}'s speech provider, and that I can withdraw this permission and have the voice deleted at any time.`,
];

/** The whole statement as one string, for anywhere that needs it flat. */
export const VOICE_CONSENT_TEXT = VOICE_CONSENT_LINES.join("\n\n");

/**
 * What each line is doing, kept beside the words themselves.
 *
 * Not rendered to the parent — this is for whoever next proposes changing the
 * wording, so a clause is removed knowingly rather than because it read as
 * boilerplate. The riskiest edit here is dropping "This is my own voice", which
 * is the on-record defence against the exact abuse the milestone exists to
 * prevent.
 */
export const VOICE_CONSENT_CLAUSE_RATIONALE: ReadonlyArray<{ line: string; why: string }> = [
  {
    line: "I [full name] am aware that recordings of my voice will be used by … to create and use a synthetic version of my voice.",
    why:
      "Microsoft's published Azure custom-voice consent statement, quoted with the company name filled in. " +
      "Identifies the speaker and establishes awareness of synthesis. Adopted verbatim so the statement rests on " +
      "a reviewed industry standard rather than on wording invented here. Do not paraphrase this line.",
  },
  {
    line: "Today is [date].",
    why:
      "Binds the recording to a moment. A consent artifact with no spoken date is far weaker evidence later — " +
      "`createdAt` says when we received it, not when they said it.",
  },
  {
    line: "I am eighteen or older, and I am the account holder.",
    why: "AC 1's adult gate, spoken rather than clicked. A checkbox proves a click; this proves an assertion.",
  },
  {
    line: "This is my own voice. I am recording this myself, of my own free will.",
    why:
      "The most important sentence in the statement. It is the on-record defence against cloning someone else, " +
      "which is the abuse this whole milestone is built around preventing — and 'of my own free will' speaks to coercion. " +
      "Microsoft's line does NOT cover this; it establishes awareness, not ownership.",
  },
  {
    line: "…use that synthetic version only to read lessons aloud to the children on my account.",
    why:
      "Scopes the permission, matching the spec's non-goal that a cloned voice is never used outside lesson " +
      "narration. Line 1 covers creation, so this line only has to carry the limit on use.",
  },
  {
    line: "…created and stored by [the app]'s speech provider … I can withdraw this permission and have the voice deleted at any time.",
    why:
      "Two clauses in one spoken line, because they are heard as one idea: someone else holds this, and you can " +
      "take it back. The third party is disclosed but deliberately NOT named, so a vendor change does not " +
      "invalidate stored consent — the written §312.4 notice names the vendor. The second half is AC 18 and AC 19 " +
      "spoken aloud, which makes revocability part of what was agreed to rather than a policy discovered later.",
  },
];
