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
 * This wording was drafted by an engineer and approved by the owner. Voice
 * cloning touches right-of-publicity law, state biometric statutes (Illinois
 * BIPA, Texas CUBI, Washington MHMD) and the vendor's own terms. **A lawyer
 * should review this before launch.** It is structurally sound — it identifies
 * the speaker, establishes adulthood and ownership, asserts the voice is their
 * own, scopes the permission, discloses third-party storage and states
 * revocability — which is what the build needs. It is not a legal opinion.
 */

export const VOICE_CONSENT_WORDING_VERSION = "2026-09-02.1";

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
  "My name is [full name]. Today is [date].",
  `I am eighteen or older, and I am the account holder for ${VOICE_CONSENT_APP_NAME}.`,
  "This is my own voice. I am recording this myself, of my own free will.",
  `I give ${VOICE_CONSENT_APP_NAME} permission to create a synthetic copy of my voice, and to use it only to read lessons aloud to the children on my account.`,
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
    line: "My name is [full name]. Today is [date].",
    why: "Binds the recording to a person AND a moment. A consent artifact with no date is far weaker evidence later.",
  },
  {
    line: "I am eighteen or older, and I am the account holder.",
    why: "AC 1's adult gate, spoken rather than clicked. A checkbox proves a click; this proves an assertion.",
  },
  {
    line: "This is my own voice. I am recording this myself, of my own free will.",
    why:
      "The most important sentence in the statement. It is the on-record defence against cloning someone else, " +
      "which is the abuse this whole milestone is built around preventing — and 'of my own free will' speaks to coercion.",
  },
  {
    line: "…use it only to read lessons aloud to the children on my account.",
    why: "Scopes the permission, matching the spec's non-goal that a cloned voice is never used outside lesson narration.",
  },
  {
    line: "…created and stored by [the app]'s speech provider…",
    why:
      "Discloses that a third party holds the voice. Deliberately unnamed so a vendor change does not invalidate " +
      "stored consent; the written §312.4 notice names the vendor.",
  },
  {
    line: "…I can withdraw this permission and have the voice deleted at any time.",
    why: "AC 18 and AC 19, spoken — revocability becomes part of what was agreed to, not a policy discovered later.",
  },
];
