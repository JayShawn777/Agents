import { describe, expect, it } from "vitest";

import skillsK8 from "@/lib/taxonomy/skills-k8.json";
import {
  candidateSlate,
  GRADABLE_SUBJECTS,
  isGradableSubject,
  resolveSkill,
  SUBJECT_FAMILY,
  TAXONOMY_VERSION,
} from "@/lib/taxonomy";
import { GRADE_LEVEL_ORDER, SUBJECT_ORDER } from "@/lib/domain/enums";

const K8: readonly string[] = [
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

/**
 * ADR-0009's own follow-up: "A unit test asserting every `code` in the file
 * is unique, every `gradeLevel` and `subject` is a valid enum member, and
 * every entry has a non-empty descriptor. A malformed taxonomy must fail CI,
 * not a student's practice set."
 */
describe("skills-k8.json — structural validity (ADR-0009 follow-up)", () => {
  const entries = skillsK8 as { code: string; descriptor: string; gradeLevel: string; subject: string }[];

  it("is non-empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every code is unique", () => {
    const codes = entries.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every gradeLevel is a real GradeLevel member, K-8 only", () => {
    expect(K8.every((g) => GRADE_LEVEL_ORDER.includes(g as (typeof GRADE_LEVEL_ORDER)[number]))).toBe(true);
    const allowed = new Set(K8);
    for (const entry of entries) {
      expect(allowed.has(entry.gradeLevel), entry.code).toBe(true);
    }
  });

  it("every subject is a real Subject member the SUBJECT_FAMILY map points at", () => {
    const families = new Set(Object.values(SUBJECT_FAMILY).filter((f) => f !== null));
    for (const entry of entries) {
      expect(families.has(entry.subject as never), entry.code).toBe(true);
    }
  });

  it("every entry has a non-empty descriptor", () => {
    for (const entry of entries) {
      expect(entry.descriptor.trim().length, entry.code).toBeGreaterThan(0);
    }
  });

  it("carries all four bundled frameworks", () => {
    const subjects = new Set(entries.map((e) => e.subject));
    expect(subjects).toEqual(new Set(["MATH", "ENGLISH_LANGUAGE_ARTS", "SCIENCE", "SOCIAL_STUDIES"]));
  });
});

/**
 * The regression guard for the defect this module was rewritten to fix:
 * `GRADABLE_SUBJECTS` was hand-written as `["MATH", "SCIENCE"]` in
 * `lib/config.ts` while the bundle carried math and ELA and no science at all.
 * Every science upload passed the gradability filter, found an empty slate,
 * and failed as `SLATE_EMPTY`; every ELA upload was filtered out one step
 * earlier. 501 tests passed over it because they all used math.
 */
describe("gradability is derived from coverage, never declared", () => {
  it("every SUBJECT_FAMILY key is a real Subject, and every Subject has an entry", () => {
    expect(new Set(Object.keys(SUBJECT_FAMILY))).toEqual(new Set(SUBJECT_ORDER));
  });

  it("every gradable subject yields a non-empty slate at EVERY K-8 grade", () => {
    for (const subject of GRADABLE_SUBJECTS) {
      for (const gradeLevel of K8) {
        const slate = candidateSlate({
          subjects: [subject],
          gradeLevel: gradeLevel as (typeof GRADE_LEVEL_ORDER)[number],
          bandGrades: 1,
        });
        expect(slate.length, `${subject} @ ${gradeLevel}`).toBeGreaterThan(0);
      }
    }
  });

  it("every non-gradable subject yields an empty slate — refused, not silently mis-graded", () => {
    for (const subject of SUBJECT_ORDER) {
      if (isGradableSubject(subject)) continue;
      expect(candidateSlate({ subjects: [subject], gradeLevel: "GRADE_4", bandGrades: 1 }), subject).toEqual([]);
    }
  });

  it("covers the core subjects the product promises", () => {
    for (const subject of ["MATH", "READING", "WRITING", "ENGLISH_LANGUAGE_ARTS", "SOCIAL_STUDIES", "HISTORY", "SCIENCE"] as const) {
      expect(isGradableSubject(subject), subject).toBe(true);
    }
  });

  it("FOREIGN_LANGUAGE is not yet covered — asserted so adding a framework must update this test deliberately", () => {
    expect(isGradableSubject("FOREIGN_LANGUAGE")).toBe(false);
  });
});

describe("SUBJECT_FAMILY (finer-grained Subject enum → coarser framework)", () => {
  it("READING and WRITING both practise against the ELA skills", () => {
    const reading = candidateSlate({ subjects: ["READING"], gradeLevel: "GRADE_4", bandGrades: 1 });
    const ela = candidateSlate({ subjects: ["ENGLISH_LANGUAGE_ARTS"], gradeLevel: "GRADE_4", bandGrades: 1 });
    expect(reading.map((s) => s.code)).toEqual(ela.map((s) => s.code));
    expect(candidateSlate({ subjects: ["WRITING"], gradeLevel: "GRADE_4", bandGrades: 1 }).map((s) => s.code)).toEqual(
      ela.map((s) => s.code),
    );
  });

  it("HISTORY practises against the social-studies (C3) skills", () => {
    const history = candidateSlate({ subjects: ["HISTORY"], gradeLevel: "GRADE_7", bandGrades: 1 });
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((s) => s.subject === "SOCIAL_STUDIES")).toBe(true);
  });

  it("a mixed worksheet unions its families without duplicating a code", () => {
    const slate = candidateSlate({ subjects: ["READING", "HISTORY", "SCIENCE"], gradeLevel: "GRADE_7", bandGrades: 1 });
    const codes = slate.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(slate.map((s) => s.subject))).toEqual(
      new Set(["ENGLISH_LANGUAGE_ARTS", "SOCIAL_STUDIES", "SCIENCE"]),
    );
  });

  it("an uncovered subject alongside a covered one does not poison the slate", () => {
    const slate = candidateSlate({ subjects: ["FOREIGN_LANGUAGE", "MATH"], gradeLevel: "GRADE_4", bandGrades: 1 });
    expect(slate.length).toBeGreaterThan(0);
    expect(slate.every((s) => s.subject === "MATH")).toBe(true);
  });
});

describe("resolveSkill (AC 7, AC 9)", () => {
  it("resolves a real code to its descriptor and grade level", () => {
    const skill = resolveSkill("4.NF.B.3");
    expect(skill).not.toBeNull();
    expect(skill?.descriptor.length).toBeGreaterThan(0);
    expect(skill?.gradeLevel).toBe("GRADE_4");
  });

  it("resolves codes from each bundled framework", () => {
    expect(resolveSkill("MS-PS1-1")?.subject).toBe("SCIENCE");
    expect(resolveSkill("D2.His.1.3-5")?.subject).toBe("SOCIAL_STUDIES");
    expect(resolveSkill("8.RI.2")?.subject).toBe("ENGLISH_LANGUAGE_ARTS");
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
