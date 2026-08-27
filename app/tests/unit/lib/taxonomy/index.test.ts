import { describe, expect, it } from "vitest";

import ccssK8 from "@/lib/taxonomy/ccss-k8.json";
import { candidateSlate, resolveSkill, TAXONOMY_VERSION } from "@/lib/taxonomy";
import { GRADE_LEVEL_ORDER } from "@/lib/domain/enums";

/**
 * ADR-0009's own follow-up: "A unit test asserting every `code` in the file
 * is unique, every `gradeLevel` and `subject` is a valid enum member, and
 * every entry has a non-empty descriptor. A malformed taxonomy must fail CI,
 * not a student's practice set."
 */
describe("ccss-k8.json — structural validity (ADR-0009 follow-up)", () => {
  const entries = ccssK8 as { code: string; descriptor: string; gradeLevel: string; subject: string }[];

  it("is non-empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every code is unique", () => {
    const codes = entries.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every gradeLevel is a real GradeLevel member, K-8 only", () => {
    const k8: readonly string[] = [
      "KINDERGARTEN",
      "GRADE_1",
      "GRADE_2",
      "GRADE_3",
      "GRADE_4",
      "GRADE_5",
      "GRADE_6",
      "GRADE_7",
      "GRADE_8",
    ];
    expect(k8.every((g) => GRADE_LEVEL_ORDER.includes(g as (typeof GRADE_LEVEL_ORDER)[number]))).toBe(true);
    const allowed = new Set(k8);
    for (const entry of entries) {
      expect(allowed.has(entry.gradeLevel), entry.code).toBe(true);
    }
  });

  it("every subject is MATH or ENGLISH_LANGUAGE_ARTS (ADR-0009 §1's Skill type)", () => {
    for (const entry of entries) {
      expect(["MATH", "ENGLISH_LANGUAGE_ARTS"]).toContain(entry.subject);
    }
  });

  it("every entry has a non-empty descriptor", () => {
    for (const entry of entries) {
      expect(entry.descriptor.trim().length, entry.code).toBeGreaterThan(0);
    }
  });
});

describe("resolveSkill (AC 7, AC 9)", () => {
  it("resolves a real code to its descriptor and grade level", () => {
    const skill = resolveSkill("4.NF.B.3");
    expect(skill).not.toBeNull();
    expect(skill?.descriptor.length).toBeGreaterThan(0);
    expect(skill?.gradeLevel).toBe("GRADE_4");
  });

  it("returns null for a code the taxonomy does not carry — a retired code never breaks a page (ADR-0009 §3)", () => {
    expect(resolveSkill("9.ZZ.NOPE.1")).toBeNull();
  });
});

describe("candidateSlate (ADR-0009 §2, AC 8 by construction)", () => {
  it("only returns skills within the grade band, in either direction", () => {
    const slate = candidateSlate({ subjects: ["MATH"], gradeLevel: "GRADE_4", bandGrades: 1 });
    expect(slate.length).toBeGreaterThan(0);
    for (const skill of slate) {
      expect(["GRADE_3", "GRADE_4", "GRADE_5"]).toContain(skill.gradeLevel);
    }
  });

  it("widening the band strictly grows (or holds) the slate", () => {
    const narrow = candidateSlate({ subjects: ["MATH"], gradeLevel: "GRADE_4", bandGrades: 0 });
    const wide = candidateSlate({ subjects: ["MATH"], gradeLevel: "GRADE_4", bandGrades: 1 });
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
  });

  it("returns [] for a subject the taxonomy does not cover at all (SCIENCE — ADR-0009 §4, NGSS not bundled)", () => {
    expect(candidateSlate({ subjects: ["SCIENCE"], gradeLevel: "GRADE_4", bandGrades: 1 })).toEqual([]);
  });

  it("returns [] for a grade level with no numeric position (ADULT_LEARNER — this bundle is K-8 only)", () => {
    expect(candidateSlate({ subjects: ["MATH"], gradeLevel: "ADULT_LEARNER", bandGrades: 1 })).toEqual([]);
  });

  it("unions multiple subjects without duplicating a code", () => {
    const slate = candidateSlate({ subjects: ["MATH", "ENGLISH_LANGUAGE_ARTS"], gradeLevel: "GRADE_4", bandGrades: 0 });
    const codes = slate.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(slate.some((s) => s.subject === "MATH")).toBe(true);
    expect(slate.some((s) => s.subject === "ENGLISH_LANGUAGE_ARTS")).toBe(true);
  });

  it("TAXONOMY_VERSION is a non-empty string (recorded on PracticeSet.taxonomyVersion)", () => {
    expect(TAXONOMY_VERSION.length).toBeGreaterThan(0);
  });
});
