import "server-only";

import { createHash } from "node:crypto";

import type { OutboundLearnerContext } from "@/lib/ai/outbound";
import type { MasteryLevel } from "@/lib/domain/enums";
import { GRADE_LEVEL_LABELS, SUBJECT_LABELS, SUBJECT_ORDER } from "@/lib/domain/enums";

/**
 * ADR-0012 §2. Bump when the RENDERED BYTES change in any way — wording,
 * ordering, punctuation, the phrases below. Stored on `ChatSession` beside the
 * render itself so an old transcript stays interpretable after this file moves
 * on: you can always tell which layout produced a given stored string.
 *
 * This is NOT a semver of the module. It is a label for one exact output shape.
 */
export const LEARNER_CONTEXT_VERSION = "m3.1";

/**
 * Deliberately NOT `MASTERY_LEVEL_LABELS`. Those are parent-and-child-facing UI
 * copy, tuned so a level that can never fall also never reads as if it could
 * ("Mastered" would invite "why did that go away?"). This map is wire format:
 * bytes in a cached prompt prefix.
 *
 * Keeping them separate means a copy tweak on a screen cannot silently change
 * the prefix of every new chat session — which would be invisible, because the
 * product would keep working and only the bill would move. The duplication is
 * the point; if these ever need to agree, that is a decision, not a refactor.
 */
const MASTERY_CONTEXT_PHRASE: Record<MasteryLevel, string> = {
  NOT_STARTED: "not started yet",
  BEGINNING: "just getting started",
  DEVELOPING: "building confidence",
  SECURE: "confident with this",
};

/**
 * Renders the learner context that ADR-0012 §2 snapshots onto
 * `ChatSession.renderedContext` at session open and then sends, byte for byte,
 * on every turn of that session.
 *
 * PURE. No database access, no clock, no randomness, no environment. That is
 * not a stylistic preference — it is the whole mechanism behind M3 AC 8. The
 * prefix cannot vary within a session because it is a stored string, and this
 * function is what makes the stored string reproducible from its inputs.
 *
 * Determinism rules, each asserted by `tests/unit/lib/chat/context.test.ts`:
 *
 *   - Subjects render in `SUBJECT_ORDER`, never in the order the caller (or
 *     Postgres) happened to supply them. Duplicates collapse.
 *   - Skills sort by `skillCode`, lexicographically, with an explicit
 *     comparator — never by locale-sensitive default `sort()`, whose result
 *     depends on the runtime's ICU data.
 *   - Only `level` is rendered per skill. Never a count, never
 *     `lastPracticedAt`, never a timestamp of any kind. A timestamp in the
 *     prefix is the exact failure ADR-0012 exists to prevent.
 *   - Prose with a fixed layout, not JSON, so key ordering is not even a
 *     question that can be got wrong.
 *
 * @param facts `OutboundLearnerContext` — a type with no name, id, avatar or
 *   email field, so M3 AC 7 holds structurally (ADR-0012 §2).
 */
export function renderLearnerContext(facts: OutboundLearnerContext): string {
  const seen = new Set<string>();
  const subjects = SUBJECT_ORDER.filter((subject) => {
    if (!facts.subjects.includes(subject) || seen.has(subject)) return false;
    seen.add(subject);
    return true;
  }).map((subject) => SUBJECT_LABELS[subject]);

  // Copy before sorting: `facts.skills` is readonly and the caller's array must
  // not be reordered underneath them.
  const skills = [...facts.skills].sort((a, b) =>
    a.skillCode < b.skillCode ? -1 : a.skillCode > b.skillCode ? 1 : 0,
  );

  const lines: string[] = [
    `Learner context (${LEARNER_CONTEXT_VERSION}).`,
    "",
    `Grade level: ${GRADE_LEVEL_LABELS[facts.gradeLevel]}.`,
    subjects.length > 0
      ? `Subjects they are working on: ${subjects.join(", ")}.`
      : "Subjects they are working on: not recorded.",
    "",
  ];

  if (skills.length === 0) {
    lines.push(
      "No practice has been recorded for this student yet, so nothing is known about which skills they find hard.",
    );
  } else {
    lines.push("How they are doing, skill by skill:");
    for (const skill of skills) {
      lines.push(`- ${skill.skillCode}: ${MASTERY_CONTEXT_PHRASE[skill.level]}`);
    }
  }

  // Trailing newline is part of the contract: it makes the boundary between
  // this block and whatever follows it in the `system` array explicit, and it
  // is one fewer thing to differ between two renders.
  return `${lines.join("\n")}\n`;
}

/**
 * sha256, hex. Stored on `ChatSession.contextHash` beside the render.
 *
 * The hash is not a cache key and is not security-relevant — it is a cheap
 * assertion that the bytes we send today are the bytes we stored at open, and
 * the handle the CI half of ADR-0012 §4 pulls on: `contextHash` must equal
 * `hashContext(renderLearnerContext(facts))` for the session's own facts.
 */
export function hashContext(rendered: string): string {
  return createHash("sha256").update(rendered, "utf8").digest("hex");
}
