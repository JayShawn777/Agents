import { describe, expect, it } from "vitest";

import { __private } from "@/lib/mastery/apply";
import { MASTERY_LADDER } from "@/lib/config";

const { levelFor } = __private;

/**
 * The owner's correction to ADR-0010, tested directly against the boundary
 * it exists for: "five consecutive correct against a six-problem set means
 * one good set carries a skill from nothing to SECURE... require the
 * evidence to span at least two distinct PracticeSets before level may
 * advance to the top rung."
 *
 * This is `levelFor` in isolation (pure, no transaction, no database) —
 * `tests/integration/mastery-two-set-ratchet.test.ts` is the sibling that
 * exercises the same boundary through `applyMastery` against real Postgres,
 * end to end.
 */
describe("levelFor — the two-set ratchet boundary (ADR-0010 correction)", () => {
  it("REGRESSION: five consecutive correct within ONE set does NOT reach the top rung (SECURE)", () => {
    // This is exactly the scenario the owner flagged as wrong in the
    // architect's original ladder: consecutiveCorrect has reached the
    // threshold, but spansTwoSets is false because every one of those five
    // correct answers came from the same PracticeSet.
    const level = levelFor(5, false);
    expect(level).not.toBe("SECURE");
    // It should still promote as far as the ladder allows WITHOUT the
    // two-set requirement — DEVELOPING's threshold (3) doesn't require it.
    expect(level).toBe("DEVELOPING");
  });

  it("six consecutive correct within ONE set still does not reach SECURE", () => {
    expect(levelFor(6, false)).toBe("DEVELOPING");
  });

  it("five consecutive correct that HAS crossed into a second set reaches SECURE", () => {
    expect(levelFor(5, true)).toBe("SECURE");
  });

  it("a lower rung (DEVELOPING, threshold 3) is unaffected by the two-set flag either way", () => {
    expect(levelFor(3, false)).toBe("DEVELOPING");
    expect(levelFor(3, true)).toBe("DEVELOPING");
  });

  it("BEGINNING (threshold 1) is unaffected by the two-set flag either way", () => {
    expect(levelFor(1, false)).toBe("BEGINNING");
    expect(levelFor(1, true)).toBe("BEGINNING");
  });

  it("zero consecutive correct is NOT_STARTED regardless of the two-set flag", () => {
    expect(levelFor(0, false)).toBe("NOT_STARTED");
    expect(levelFor(0, true)).toBe("NOT_STARTED");
  });

  it("MASTERY_LADDER's top rung is the ONLY one flagged requiresMultiplePracticeSets — a config-shape assertion, so the ladder can't silently gain a second gated rung unnoticed", () => {
    const gated = MASTERY_LADDER.filter((rung) => rung.requiresMultiplePracticeSets);
    expect(gated.map((rung) => rung.level)).toEqual(["SECURE"]);
  });

  it("the full ladder, table-driven, at the exact configured thresholds", () => {
    for (const rung of MASTERY_LADDER) {
      const withoutSecondSet = levelFor(rung.threshold, false);
      if (rung.requiresMultiplePracticeSets) {
        expect(withoutSecondSet, `threshold ${rung.threshold} without a second set`).not.toBe(rung.level);
      } else {
        expect(withoutSecondSet, `threshold ${rung.threshold} without a second set`).toBe(rung.level);
      }
      expect(levelFor(rung.threshold, true), `threshold ${rung.threshold} WITH a second set`).toBe(rung.level);
    }
  });
});
