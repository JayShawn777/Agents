/**
 * Versioned §312.4 direct-notice copy (M0 AC 12-14, B9). `DIRECT_NOTICE_VERSION`
 * lives HERE, beside the copy, deliberately NOT in `lib/config.ts` (plan §7):
 * changing the wording and bumping the version are the same diff, so a
 * content edit can never land without a new version identifier, and an
 * existing `DirectNotice` row keeps showing the version that was actually
 * served to it (AC 14) rather than "whatever is deployed now".
 *
 * Rendered from ONE place by both consumers, so they can never drift:
 *   - the notice screen (`app/(app)/students/[studentId]/notice/page.tsx`,
 *     frontend track, out of this task's scope);
 *   - the notice email (`lib/notice/service.ts`, this task).
 *
 * No `server-only` import: a server COMPONENT (not a route handler) is one
 * of the two intended consumers, and this module touches no secrets, no
 * `process.env` and no database — it is plain, framework-agnostic data.
 *
 * Bumping the version: change `DIRECT_NOTICE_VERSION` in the SAME commit as
 * any change to `DIRECT_NOTICE_COPY`. Nothing enforces this mechanically;
 * it is a review discipline, named here so it is not missed.
 */

export const DIRECT_NOTICE_VERSION = "2026-08-26.1";

export type DirectNoticeThirdParty = {
  name: string;
  receives: string;
};

export type DirectNoticeCopy = {
  version: string;
  /** The specific items of personal information collected from the child (AC 12). */
  collected: readonly string[];
  /** How each item above is used (AC 12). */
  uses: readonly string[];
  /** Named third parties and what each receives (AC 13). */
  thirdParties: readonly DirectNoticeThirdParty[];
  /** The parent's rights, and that they may exercise each (AC 12). */
  rights: readonly string[];
  /** Link to the published retention policy (AC 12, AC 44). */
  retentionPolicyPath: string;
  /** Link to the online privacy policy (AC 12). */
  privacyPolicyPath: string;
};

export const DIRECT_NOTICE_COPY: DirectNoticeCopy = {
  version: DIRECT_NOTICE_VERSION,
  collected: [
    "Photos and PDF scans of your child's schoolwork that they upload.",
    "The problem text our system reads out of those uploads.",
    "A display name, grade level, list of subjects and an avatar selection chosen for your child.",
  ],
  uses: [
    "The uploaded images and PDFs are read to identify individual problems and are then deleted on a fixed schedule after that reading is done — see the retention policy linked below.",
    "The extracted problem text is used to generate practice and tutoring for your child for as long as the account is in use.",
    "The display name, grade level, subjects and avatar are used to personalize what your child sees.",
  ],
  thirdParties: [
    {
      name: "Anthropic",
      receives:
        "the uploaded schoolwork images/PDFs and the extracted problem text, to read them and generate a response.",
    },
    {
      name: "Vercel",
      receives: "the uploaded files, stored privately on our behalf.",
    },
    {
      name: "Neon",
      receives: "the database records described in this notice.",
    },
    {
      name: "Our transactional email provider",
      receives: "the account holder's email address only, to deliver this notice and other account messages.",
    },
  ],
  rights: [
    "Review the personal information we have collected about your child.",
    "Refuse to permit its further collection or use, at any time.",
    "Direct us to delete it, at any time — including immediately, without needing to close the account.",
  ],
  retentionPolicyPath: "/retention",
  privacyPolicyPath: "/privacy",
};
