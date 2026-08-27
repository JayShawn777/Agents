/**
 * ADR-0011 §1 — the deterministic normaliser. PURE: no database, no
 * network, no model, and deliberately no `server-only` (this is the highest
 * value unit test in M2 per the architect's own file-order note, B25, and a
 * pure function is what makes that possible with zero mocks).
 *
 * Rational arithmetic is done on `bigint` numerator/denominator — never
 * floating point, so `0.1 + 0.2` never appears and a repeating decimal never
 * silently rounds to the wrong fraction.
 *
 * Its domain is deliberately narrow and exactly covers M2 AC 13's examples:
 * whitespace/case/unicode-minus/thousands-separator cleanup, a leading
 * `variable =` prefix, integers and decimals as exact rationals, fractions
 * (including improper and unsimplified) and mixed numbers, trailing units
 * and `$`, percent, and short-text casing/article/punctuation cleanup.
 * Anything outside this domain returns `null` and falls to stage two
 * (`lib/grading/adjudicate.ts`) — it never guesses.
 */

import type { AnswerFormat } from "@/lib/domain/enums";

type Rational = { num: bigint; den: bigint };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < BigInt(0) ? -a : a;
  let y = b < BigInt(0) ? -b : b;
  while (y !== BigInt(0)) {
    [x, y] = [y, x % y];
  }
  return x === BigInt(0) ? BigInt(1) : x;
}

function reduce(r: Rational): Rational {
  const sign = r.den < BigInt(0) ? BigInt(-1) : BigInt(1);
  const num = r.num * sign;
  const den = r.den * sign;
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

function rationalToKey(r: Rational): string {
  const reduced = reduce(r);
  return `${reduced.num}/${reduced.den}`;
}

/** Unicode minus / dash variants a phone keyboard or a pasted answer might carry, normalised to ASCII `-`. */
const MINUS_VARIANTS = /[−‒–—―]/g;

function cleanupNumericText(raw: string): string {
  return raw
    .trim()
    .replace(MINUS_VARIANTS, "-")
    // Thousands separators: a comma directly between two digits.
    .replace(/(\d),(?=\d)/g, "$1")
    // A leading currency symbol.
    .replace(/^\$\s*/, "");
}

/** `x = 3` -> `3`. Applied before rational parsing; a no-op if there is no such prefix. */
function stripVariablePrefix(text: string): string {
  return text.replace(/^[a-zA-Z][a-zA-Z0-9]*\s*=\s*/, "");
}

const MIXED_NUMBER = /^(-?\d+)\s+(\d+)\/(\d+)$/;
const FRACTION = /^(-?\d+)\/(\d+)$/;
const DECIMAL_OR_INTEGER = /^-?\d+(\.\d+)?$/;
/** A trailing unit word or abbreviation: `12 cm`, `4.50 dollars`. Stripped only as a fallback, after a bare numeric parse has already failed. */
const TRAILING_UNIT = /\s*[a-zA-Z]+\.?$/;

function parseRational(text: string): Rational | null {
  const percent = text.endsWith("%");
  const body = percent ? text.slice(0, -1).trim() : text;

  const rational = parseRationalCore(body);
  if (!rational) return null;
  if (!percent) return rational;
  return { num: rational.num, den: rational.den * BigInt(100) };
}

function parseRationalCore(text: string): Rational | null {
  const mixed = text.match(MIXED_NUMBER);
  if (mixed) {
    const [, whole, num, den] = mixed;
    const w = BigInt(whole);
    const n = BigInt(num);
    const d = BigInt(den);
    if (d === BigInt(0)) return null;
    const sign = w < BigInt(0) ? BigInt(-1) : BigInt(1);
    return { num: w * d + sign * n, den: d };
  }

  const fraction = text.match(FRACTION);
  if (fraction) {
    const [, num, den] = fraction;
    const d = BigInt(den);
    if (d === BigInt(0)) return null;
    return { num: BigInt(num), den: d };
  }

  if (DECIMAL_OR_INTEGER.test(text)) {
    const negative = text.startsWith("-");
    const unsigned = negative ? text.slice(1) : text;
    const [wholePart, fractionPart = ""] = unsigned.split(".");
    const den = BigInt(10) ** BigInt(fractionPart.length);
    const num = BigInt((wholePart || "0") + fractionPart || "0");
    return { num: negative ? -num : num, den };
  }

  return null;
}

function normalizeNumeric(raw: string): string | null {
  const cleaned = stripVariablePrefix(cleanupNumericText(raw));

  const direct = parseRational(cleaned);
  if (direct) return rationalToKey(direct);

  // Fallback: a trailing unit ("12 cm", "4 apples") that a bare parse can't
  // see past. Only tried once the unmodified text has already failed.
  const withoutUnit = cleaned.replace(TRAILING_UNIT, "").trim();
  if (withoutUnit !== cleaned && withoutUnit.length > 0) {
    const withUnitStripped = parseRational(withoutUnit);
    if (withUnitStripped) return rationalToKey(withUnitStripped);
  }

  return null;
}

const LEADING_ARTICLE = /^(the|a|an)\s+/i;
const TRAILING_PUNCTUATION = /[.!?,;:'"]+$/;

function normalizeShortText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const withoutArticle = trimmed.toLowerCase().replace(LEADING_ARTICLE, "");
  const withoutPunctuation = withoutArticle.replace(TRAILING_PUNCTUATION, "");
  const collapsed = withoutPunctuation.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Returns a canonical form for `raw` under `format`, or `null` if `raw` is
 * outside this function's domain (never a guess). `NUMERIC`, `FRACTION` and
 * `EXPRESSION` share the rational path — `EXPRESSION` intentionally does NOT
 * attempt symbolic simplification (ADR-0011's "Alternatives considered:
 * add a computer-algebra dependency" was rejected); an expression like
 * `2(x+1)` returns `null` here and is stage two's job. `MULTIPLE_CHOICE`
 * uses the same cleanup as `SHORT_TEXT` — a chosen option is compared as
 * text, never by position.
 */
export function normalize(raw: string, format: AnswerFormat): string | null {
  if (format === "SHORT_TEXT" || format === "MULTIPLE_CHOICE") {
    return normalizeShortText(raw);
  }
  return normalizeNumeric(raw);
}

/**
 * The stage-one grading decision (ADR-0011 §1). Returns:
 *   - `true`  — CORRECT, decided by the normaliser
 *   - `false` — INCORRECT, decided by the normaliser (every side parsed and
 *     none matched — a decidable comparison that came out negative is still
 *     a confident decision, not an inconclusive one)
 *   - `null`  — cannot decide; falls to stage two (`lib/grading/adjudicate.ts`)
 *
 * Comparing `2/4` against a key of `1/2` returns `true` with NO entry
 * required in `acceptedForms` — canonicalisation, not enumeration, is what
 * makes unsimplified forms equivalent (M2 AC 13's third example).
 */
export function answersEquivalent(
  submitted: string,
  canonicalAnswer: string,
  acceptedForms: readonly string[],
  format: AnswerFormat,
): boolean | null {
  const normalizedSubmitted = normalize(submitted, format);
  if (normalizedSubmitted === null) return null;

  const normalizedCandidates = [canonicalAnswer, ...acceptedForms]
    .map((candidate) => normalize(candidate, format))
    .filter((candidate): candidate is string => candidate !== null);

  if (normalizedCandidates.length === 0) return null;

  return normalizedCandidates.includes(normalizedSubmitted);
}
