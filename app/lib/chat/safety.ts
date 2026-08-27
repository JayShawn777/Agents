import "server-only";

/**
 * M3 AC 21 (plan B38) — the distress check.
 *
 * **What this is.** A deterministic, local check that runs on the student's
 * message BEFORE the AI call. On a hit the tutor does not tutor: the fixed
 * `DISTRESS_SAFETY_MESSAGE` is written as the assistant reply with
 * `safetyResponse: true`, and no request reaches Anthropic.
 *
 * **Why it is not a model call.** Three reasons, in order of weight. The reply
 * a distressed child reads must be text a person chose, not text a model
 * generated — that is the whole point of AC 21, and a classifier deciding
 * whether to show it reintroduces the model into the one path we removed it
 * from. It must also work when the API is down, which is exactly when a child
 * having a bad night might be talking to it. And it must be fast: a child who
 * has just typed something hard should not watch a spinner.
 *
 * **What it is NOT.** It is not a safeguarding system, it is not triage, and it
 * does not decide whether a child is actually in danger. It decides one thing:
 * whether to stop tutoring for this turn and point at a trusted adult. The
 * plan states plainly that this check "has false negatives and false positives
 * and neither is measurable in CI".
 *
 * **The asymmetry that shapes the list below.** A false positive costs a child
 * one turn of tutoring and an unnecessary, kind message. A false negative is a
 * child who has said something serious being answered with a question about
 * fractions. Those costs are not close, so the patterns lean toward recall and
 * the list deliberately does not try to be clever about excluding hyperbole.
 *
 * Everything here is matched against the student's own message only. Nothing is
 * logged, and no message content leaves the request.
 */

/**
 * Self-referential harm, being hurt by someone, and the phrases that most often
 * carry real distress in a child's own words.
 *
 * Written as explicit phrases rather than a keyword bag on purpose: "kill",
 * "die" and "hurt" on their own are ordinary words in a maths conversation
 * ("this is killing me", "I died laughing", "my hand hurts"), and a bag of
 * keywords would fire on all of them while catching nothing a phrase list
 * misses. The self-reference — *myself*, *me*, *my life* — is what carries the
 * signal, so it is part of every pattern.
 *
 * `\b` word boundaries throughout, against a normalised string (see below), so
 * spacing, capitalisation and apostrophe style cannot defeat a match.
 */
const DISTRESS_PATTERNS: readonly RegExp[] = [
  // Suicidal ideation.
  /\bkill(ing)? myself\b/,
  /\bkill me\b/,
  /\btake my own life\b/,
  /\bend(ing)? my life\b/,
  // "wanna" already carries the "to", so it needs its own alternative — the
  // fixture "i wanna die" is exactly how a child writes this, and an earlier
  // `(want|wanna) to die` silently matched neither.
  //
  // "going to die" and "gonna die" are DELIBERATELY absent: "im gonna die if I
  // do one more of these" is ordinary homework hyperbole, and firing on it
  // would make the tutor unusable without catching anything the two patterns
  // below miss.
  /\bwant to die\b/,
  /\bwanna die\b/,
  /\bi wish i (was|were) dead\b/,
  /\bbetter off dead\b/,
  /\b(dont|do not) want to (live|be alive|be here)\b/,
  /\b(dont|do not) want to wake up\b/,
  /\bnobody would (miss|care about) me\b/,
  /\bno one would (miss|care about) me\b/,

  // Self-harm.
  /\b(hurt|hurting|harm|harming) myself\b/,
  /\b(cut|cutting) myself\b/,
  /\bself[ -]?harm/,
  /\bi hate myself\b/,

  // Being hurt by someone. The object is the child, which is what separates
  // these from a child describing a story, a game or a history lesson.
  /\b(hits|hit|hurts|hurt|beats|beat|punches|punched|kicks|kicked) me\b/,
  /\b(touches|touched) me\b/,
  /\bbeing (hurt|abused|bullied)\b/,
  /\b(someone|somebody) (is )?(hurting|hurts|touching|touched) me\b/,

  // Fear for their own safety.
  /\b(scared|afraid|frightened) to go home\b/,
  /\bi (dont|do not) feel safe\b/,
  /\bi(m| am)? not safe\b/,
  /\brun(ning)? away from home\b/,
];

/**
 * Lower-cases, folds curly apostrophes to straight ones, strips the apostrophes
 * entirely so "don't" and "dont" are one string, and collapses everything that
 * is not a letter or digit to a single space.
 *
 * Stripping punctuation rather than matching around it is what makes
 * "I want to die." and "i-want-to-die" and "I WANT TO DIE!!!" the same input.
 * A child in distress is not punctuating carefully.
 */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when the student's message should stop tutoring for this turn.
 *
 * The caller must, on a hit: persist the fixed message as the assistant reply
 * with `safetyResponse: true`, make NO AI call, and offer no advice, diagnosis
 * or counselling of its own (`app/api/chat/sessions/[sessionId]/messages/route.ts`
 * and `lib/chat/stream.ts`).
 */
export function detectsDistress(message: string): boolean {
  const normalized = normalize(message);
  return DISTRESS_PATTERNS.some((pattern) => pattern.test(normalized));
}
