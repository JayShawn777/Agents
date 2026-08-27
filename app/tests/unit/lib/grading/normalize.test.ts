import { describe, expect, it } from "vitest";

import { answersEquivalent, normalize } from "@/lib/grading/normalize";

/**
 * M2 AC 13: "A fixture table of equivalent forms is the test." Pure,
 * table-driven, no mocks, no database, no model — ADR-0011 §1 calls this
 * "the highest-value unit test in M2... the one that will still be true in
 * a year."
 */
describe("normalize / answersEquivalent — AC 13 fixture table", () => {
  const equivalentCases: {
    submitted: string;
    canonicalAnswer: string;
    format: "NUMERIC" | "FRACTION" | "EXPRESSION" | "SHORT_TEXT";
  }[] = [
    { submitted: "0.5", canonicalAnswer: "1/2", format: "NUMERIC" },
    { submitted: "1/2", canonicalAnswer: "0.5", format: "FRACTION" },
    { submitted: "x = 3", canonicalAnswer: "3", format: "EXPRESSION" },
    { submitted: "3", canonicalAnswer: "x = 3", format: "EXPRESSION" },
    // AC 13's third example: unsimplified forms accepted WITHOUT needing to
    // be enumerated in acceptedForms — canonicalisation does the work.
    { submitted: "2/4", canonicalAnswer: "1/2", format: "FRACTION" },
    { submitted: "4/8", canonicalAnswer: "1/2", format: "FRACTION" },
    { submitted: "1 1/2", canonicalAnswer: "3/2", format: "FRACTION" },
    { submitted: "50%", canonicalAnswer: "1/2", format: "NUMERIC" },
    { submitted: "$4.50", canonicalAnswer: "4.5", format: "NUMERIC" },
    { submitted: "12 cm", canonicalAnswer: "12", format: "NUMERIC" },
    { submitted: "1,024", canonicalAnswer: "1024", format: "NUMERIC" },
    { submitted: "−3", canonicalAnswer: "-3", format: "NUMERIC" },
    { submitted: "-3", canonicalAnswer: "−3", format: "NUMERIC" },
    { submitted: "  7  ", canonicalAnswer: "7", format: "NUMERIC" },
    { submitted: "The Nile.", canonicalAnswer: "nile", format: "SHORT_TEXT" },
  ];

  it.each(equivalentCases)(
    "$submitted is graded CORRECT against key $canonicalAnswer ($format)",
    ({ submitted, canonicalAnswer, format }) => {
      expect(answersEquivalent(submitted, canonicalAnswer, [], format)).toBe(true);
    },
  );

  it("The Nile / nile — short-text casing, article and punctuation cleanup", () => {
    expect(normalize("The Nile.", "SHORT_TEXT")).toBe("nile");
    expect(normalize("a Fish", "SHORT_TEXT")).toBe("fish");
  });

  const incorrectCases: { submitted: string; canonicalAnswer: string; format: "NUMERIC" | "FRACTION" }[] = [
    { submitted: "3", canonicalAnswer: "5", format: "NUMERIC" },
    { submitted: "1/3", canonicalAnswer: "1/2", format: "FRACTION" },
    { submitted: "0.4", canonicalAnswer: "1/2", format: "NUMERIC" },
  ];

  it.each(incorrectCases)(
    "$submitted is decided INCORRECT (not UNSCORED) against key $canonicalAnswer — both parse, neither matches",
    ({ submitted, canonicalAnswer, format }) => {
      expect(answersEquivalent(submitted, canonicalAnswer, [], format)).toBe(false);
    },
  );

  const undecidableCases: { submitted: string; canonicalAnswer: string; format: "EXPRESSION" | "NUMERIC" }[] = [
    // A genuine algebraic expression the normaliser must not guess at.
    { submitted: "2(x+1)", canonicalAnswer: "2x+2", format: "EXPRESSION" },
    { submitted: "banana", canonicalAnswer: "5", format: "NUMERIC" },
  ];

  it.each(undecidableCases)(
    "$submitted cannot be decided by the normaliser and falls to stage two (null, never a guess)",
    ({ submitted, canonicalAnswer, format }) => {
      expect(answersEquivalent(submitted, canonicalAnswer, [], format)).toBeNull();
    },
  );

  it("MULTIPLE_CHOICE compares the chosen text, never a position", () => {
    expect(answersEquivalent("Paris", "Paris", ["paris"], "MULTIPLE_CHOICE")).toBe(true);
    expect(answersEquivalent("London", "Paris", [], "MULTIPLE_CHOICE")).toBe(false);
  });

  it("an empty or whitespace-only submission normalizes to null (no attempt row is the caller's job — AC 15 — but this function must not crash or guess)", () => {
    expect(normalize("", "NUMERIC")).toBeNull();
    expect(normalize("   ", "SHORT_TEXT")).toBeNull();
  });

  it("0.1 + 0.2 style inputs never round via floating point — exact bigint rationals", () => {
    expect(normalize("0.1", "NUMERIC")).toBe("1/10");
    expect(normalize("0.2", "NUMERIC")).toBe("1/5");
    expect(normalize("0.30000000000000004", "NUMERIC")).not.toBe(normalize("0.3", "NUMERIC"));
    expect(normalize("0.3", "NUMERIC")).toBe("3/10");
  });

  it("a division by zero in a submitted fraction never throws and is undecidable", () => {
    expect(normalize("5/0", "FRACTION")).toBeNull();
  });
});
