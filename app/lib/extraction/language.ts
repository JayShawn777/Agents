/**
 * Deciding what goes in `ExtractedProblem.language` (ADR-0016).
 *
 * PURE — no database, no `server-only`. The allowlist is a parameter with a
 * default so tests can supply their own, the same shape
 * `composeCheckpoint(candidates, size, minSkills)` uses.
 *
 * Two rules, and the narrow one is deliberate.
 *
 * **Only a foreign-language problem gets a language.** The extraction model can
 * usually tell that a maths worksheet is written in English, and we do not
 * record it. This app treats a child's schoolwork as sensitive personal data,
 * so a field is worth storing when something needs it — ADR-0016's
 * proficiency-banded generation, and M8's spoken practice — and not otherwise.
 * The schema comment on the column says the same thing; this function is what
 * makes it true.
 *
 * **An unsupported language is null, never a stored guess.** `SUPPORTED_LANGUAGES`
 * is empty on purpose until ACTFL skills are bundled, so today every value
 * resolves to null and the column is inert. That is the intended state: the
 * plumbing is live and tested, and turning it on is a data-only change. Storing
 * an unvalidated code in the meantime would recreate the 2026-08-27 coverage
 * defect — a value the system appears to support with nothing behind it.
 */

import { SUPPORTED_LANGUAGES } from "@/lib/config";
import type { Subject } from "@/lib/domain/enums";

/**
 * Folds a model-reported language tag to its primary subtag, lowercased:
 * `"es-MX"` and `" ES "` both become `"es"`. Region and script carry no meaning
 * for choosing practice — a learner of Spanish is a learner of Spanish — and
 * collapsing them keeps the allowlist one entry per language rather than one
 * per locale.
 */
function primarySubtag(raw: string): string {
  return raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

export function resolveProblemLanguage(args: {
  subject: Subject | null;
  reported: string | null;
  allowlist?: readonly string[];
}): string | null {
  if (args.subject !== "FOREIGN_LANGUAGE") return null;
  // `typeof`, not `=== null`: this reads a model's structured output, and a
  // missing key arrives as `undefined`. Narrowing on null alone would send
  // `undefined` into `primarySubtag` and throw inside the extraction
  // transaction — a crash on the write path to spare a null.
  if (typeof args.reported !== "string") return null;

  const allowlist = args.allowlist ?? SUPPORTED_LANGUAGES;
  const tag = primarySubtag(args.reported);
  if (tag === "") return null;
  return allowlist.includes(tag) ? tag : null;
}
