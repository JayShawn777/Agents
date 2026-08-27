import { describe, expect, it } from "vitest";

import { resolveProblemLanguage } from "@/lib/extraction/language";
import { SUPPORTED_LANGUAGES } from "@/lib/config";

/** `lib/extraction/language.ts` — M2.5 slice 7 / ADR-0016. */

const WITH = ["es", "fr", "de"] as const;

describe("only a foreign-language problem gets a language", () => {
  it("records a supported language for a FOREIGN_LANGUAGE problem", () => {
    expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported: "es", allowlist: WITH })).toBe("es");
  });

  it("discards it for every other subject, however confident the model was", () => {
    for (const subject of ["MATH", "SCIENCE", "ENGLISH_LANGUAGE_ARTS", "READING", "HISTORY"] as const) {
      expect(resolveProblemLanguage({ subject, reported: "es", allowlist: WITH })).toBeNull();
    }
  });

  it("discards it for an English worksheet even though the model can read the language", () => {
    // We are not collecting the language of every page a child photographs.
    expect(resolveProblemLanguage({ subject: "MATH", reported: "en", allowlist: [...WITH, "en"] })).toBeNull();
  });

  it("discards it when the subject is unknown", () => {
    expect(resolveProblemLanguage({ subject: null, reported: "es", allowlist: WITH })).toBeNull();
  });
});

describe("normalisation", () => {
  it("folds a region subtag away — a learner of Spanish is a learner of Spanish", () => {
    for (const reported of ["es-MX", "es-ES", "es_419", "ES-mx"]) {
      expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported, allowlist: WITH })).toBe("es");
    }
  });

  it("trims and lowercases", () => {
    expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported: "  FR  ", allowlist: WITH })).toBe("fr");
  });

  it("an empty or whitespace-only report is null, not an empty string", () => {
    for (const reported of ["", "   ", "-"]) {
      expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported, allowlist: WITH })).toBeNull();
    }
  });

  it("a null report stays null", () => {
    expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported: null, allowlist: WITH })).toBeNull();
  });
});

describe("the allowlist is the gate", () => {
  it("an unsupported language is null, never a stored guess", () => {
    expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported: "ja", allowlist: WITH })).toBeNull();
  });

  it("a model inventing prose instead of a code is rejected rather than persisted", () => {
    expect(
      resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported: "Spanish (beginner)", allowlist: WITH }),
    ).toBeNull();
  });

  it("today's real allowlist is empty, so the column is inert until ACTFL skills land", () => {
    // Guards the intent recorded in SUPPORTED_LANGUAGES' docstring: adding an
    // entry here without the taxonomy work recreates the coverage defect of
    // 2026-08-27. If this test fails, the taxonomy work must have landed too.
    expect(SUPPORTED_LANGUAGES).toHaveLength(0);
    expect(resolveProblemLanguage({ subject: "FOREIGN_LANGUAGE", reported: "es" })).toBeNull();
  });
});

it("a missing key from the model is null, not a crash on the extraction write path", () => {
  // Deliberately bypasses the type: this guards the RUNTIME shape, because the
  // value comes from a model's structured output and a missing key arrives as
  // `undefined` however the type is declared.
  const withoutKey = { subject: "FOREIGN_LANGUAGE", allowlist: WITH } as unknown as Parameters<
    typeof resolveProblemLanguage
  >[0];
  expect(resolveProblemLanguage(withoutKey)).toBeNull();
});
