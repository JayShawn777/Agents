import { describe, expect, it } from "vitest";

import { composeCheckpoint, type CheckpointCandidate } from "@/lib/checkpoints/compose";
import { CHECKPOINT_MIN_SKILLS, CHECKPOINT_SIZE } from "@/lib/config";

/** `lib/checkpoints/compose.ts` — M2.5 slice 4. Pure, so tested exhaustively. */

function candidate(overrides: Partial<CheckpointCandidate> & { skillCode: string }): CheckpointCandidate {
  return { attemptCount: 1, lastPracticedAt: new Date("2026-01-01T00:00:00Z"), ...overrides };
}

/** `n` skills, each practised one day later than the last — so s0 is oldest. */
function ladder(n: number): CheckpointCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    candidate({ skillCode: `s${i}`, lastPracticedAt: new Date(Date.UTC(2026, 0, 1 + i)) }),
  );
}

describe("eligibility (AC 1, AC 2)", () => {
  it("refuses below the minimum, and says how far short it is", () => {
    const result = composeCheckpoint(ladder(CHECKPOINT_MIN_SKILLS - 1));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("NOT_ENOUGH_SKILLS");
    expect(result.distinctSkills).toBe(CHECKPOINT_MIN_SKILLS - 1);
    expect(result.required).toBe(CHECKPOINT_MIN_SKILLS);
  });

  it("accepts exactly the minimum — the boundary is inclusive", () => {
    expect(composeCheckpoint(ladder(CHECKPOINT_MIN_SKILLS)).ok).toBe(true);
  });

  it("never asks about a skill the student has not attempted — no placement test", () => {
    const pool = [...ladder(CHECKPOINT_MIN_SKILLS), candidate({ skillCode: "unpractised", attemptCount: 0 })];
    const result = composeCheckpoint(pool);

    if (!result.ok) throw new Error("expected a composition");
    expect(result.skillCodes).not.toContain("unpractised");
  });

  it("an unattempted skill does not count toward the minimum either", () => {
    const pool = [
      ...ladder(CHECKPOINT_MIN_SKILLS - 1),
      candidate({ skillCode: "unpractised", attemptCount: 0 }),
    ];
    expect(composeCheckpoint(pool).ok).toBe(false);
  });

  it("ignores a duplicated skill code rather than asking it twice for the wrong reason", () => {
    const pool = [...ladder(CHECKPOINT_MIN_SKILLS), candidate({ skillCode: "s0" })];
    const result = composeCheckpoint(pool, CHECKPOINT_MIN_SKILLS);

    if (!result.ok) throw new Error("expected a composition");
    expect(new Set(result.skillCodes).size).toBe(CHECKPOINT_MIN_SKILLS);
  });
});

describe("ordering (AC 3) — the whole point is retention", () => {
  it("asks the least recently practised skill first", () => {
    const result = composeCheckpoint(ladder(CHECKPOINT_SIZE), CHECKPOINT_SIZE);

    if (!result.ok) throw new Error("expected a composition");
    expect(result.skillCodes[0]).toBe("s0");
    expect(result.skillCodes).toEqual(Array.from({ length: CHECKPOINT_SIZE }, (_, i) => `s${i}`));
  });

  it("takes the OLDEST when there are more eligible skills than slots, not the first it found", () => {
    const many = ladder(CHECKPOINT_SIZE + 5);
    // Hand it newest-first, so an implementation that skipped sorting would
    // return the newest and pass a weaker test.
    const result = composeCheckpoint([...many].reverse(), CHECKPOINT_SIZE);

    if (!result.ok) throw new Error("expected a composition");
    expect(result.skillCodes).toEqual(Array.from({ length: CHECKPOINT_SIZE }, (_, i) => `s${i}`));
  });

  it("a null lastPracticedAt sorts first — read as 'so long ago nothing recorded it'", () => {
    const pool = [...ladder(CHECKPOINT_MIN_SKILLS), candidate({ skillCode: "zz_never", lastPracticedAt: null })];
    const result = composeCheckpoint(pool, CHECKPOINT_MIN_SKILLS + 1);

    if (!result.ok) throw new Error("expected a composition");
    expect(result.skillCodes[0]).toBe("zz_never");
  });

  it("is deterministic when timestamps tie — same rows, same checkpoint, every time", () => {
    const sameInstant = new Date("2026-02-02T00:00:00Z");
    const pool = ["c", "a", "b", "d"].map((code) => candidate({ skillCode: code, lastPracticedAt: sameInstant }));

    const first = composeCheckpoint(pool, 4);
    const second = composeCheckpoint([...pool].reverse(), 4);

    if (!first.ok || !second.ok) throw new Error("expected compositions");
    expect(first.skillCodes).toEqual(["a", "b", "c", "d"]);
    expect(second.skillCodes).toEqual(first.skillCodes);
  });
});

describe("cycling when there are fewer skills than slots", () => {
  it("asks every eligible skill once before asking any of them twice", () => {
    const result = composeCheckpoint(ladder(3), 8);

    if (!result.ok) throw new Error("expected a composition");
    expect(result.skillCodes).toEqual(["s0", "s1", "s2", "s0", "s1", "s2", "s0", "s1"]);
  });

  it("always fills exactly `size` slots, however small the pool", () => {
    for (const poolSize of [3, 4, 5, 8, 13]) {
      const result = composeCheckpoint(ladder(poolSize), CHECKPOINT_SIZE);
      if (!result.ok) throw new Error("expected a composition");
      expect(result.skillCodes).toHaveLength(CHECKPOINT_SIZE);
    }
  });

  it("does not repeat at all when the pool is at least as large as the set", () => {
    const result = composeCheckpoint(ladder(CHECKPOINT_SIZE), CHECKPOINT_SIZE);

    if (!result.ok) throw new Error("expected a composition");
    expect(new Set(result.skillCodes).size).toBe(CHECKPOINT_SIZE);
  });
});

describe("purity", () => {
  it("does not mutate the caller's array", () => {
    const pool = ladder(CHECKPOINT_SIZE + 2);
    const before = pool.map((c) => c.skillCode);

    composeCheckpoint(pool);

    expect(pool.map((c) => c.skillCode)).toEqual(before);
  });
});
