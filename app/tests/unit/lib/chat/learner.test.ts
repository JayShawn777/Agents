import { beforeEach, expect, it, vi } from "vitest";

const dbMock = { skillMastery: { findMany: vi.fn() } };
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { loadLearnerContext } = await import("@/lib/chat/learner");

/** `lib/chat/learner.ts` — the facts ADR-0012 §2 renders and snapshots. */

beforeEach(() => {
  vi.clearAllMocks();
});

it("derives subjects from the skills the student actually has, deduplicated", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue([
    { skillCode: "4.NF.B.3", level: "DEVELOPING" },
    { skillCode: "4.OA.A.1", level: "SECURE" },
  ]);

  const context = await loadLearnerContext({ studentProfileId: "sp_1", gradeLevel: "GRADE_4" });
  expect(context.subjects).toEqual(["MATH"]);
  expect(context.gradeLevel).toBe("GRADE_4");
});

/**
 * `findMany` has no guaranteed order without an `orderBy`, and byte-stability
 * of the rendered prefix is the whole cost model. Subjects are sorted into
 * `SUBJECT_ORDER` here as well as in the renderer — belt and braces, because a
 * varying prefix fails silently and expensively.
 */
it("orders subjects deterministically regardless of the order Postgres returns", async () => {
  const rows = [
    { skillCode: "RL.4.1", level: "BEGINNING" },
    { skillCode: "4.NF.B.3", level: "DEVELOPING" },
  ];
  dbMock.skillMastery.findMany.mockResolvedValue(rows);
  const forward = await loadLearnerContext({ studentProfileId: "sp_1", gradeLevel: "GRADE_4" });

  dbMock.skillMastery.findMany.mockResolvedValue([...rows].reverse());
  const backward = await loadLearnerContext({ studentProfileId: "sp_1", gradeLevel: "GRADE_4" });

  expect(backward.subjects).toEqual(forward.subjects);
});

it("returns no subjects for a student with no mastery rows yet", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue([]);
  const context = await loadLearnerContext({ studentProfileId: "sp_1", gradeLevel: "GRADE_1" });
  expect(context.subjects).toEqual([]);
  expect(context.skills).toEqual([]);
});

/**
 * A skill code that has left the bundled taxonomy (a `TAXONOMY_VERSION` bump is
 * exactly what makes this reachable) contributes no subject rather than
 * defaulting to MATH — the "it very nearly shipped as a math app" failure mode.
 * The skill itself is still carried, because the student's mastery of it is
 * real even when we can no longer name its subject.
 */
it("drops an unresolvable skill code from subjects without guessing MATH", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue([{ skillCode: "NOT.A.REAL.CODE", level: "SECURE" }]);
  const context = await loadLearnerContext({ studentProfileId: "sp_1", gradeLevel: "GRADE_4" });
  expect(context.subjects).toEqual([]);
  expect(context.skills).toEqual([{ skillCode: "NOT.A.REAL.CODE", level: "SECURE" }]);
});

/** AC 7 — the returned type structurally cannot carry an identifier. */
it("returns no identifier of any kind", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue([{ skillCode: "4.NF.B.3", level: "SECURE" }]);
  const context = await loadLearnerContext({ studentProfileId: "sp_profile_secret", gradeLevel: "GRADE_4" });
  expect(JSON.stringify(context)).not.toContain("sp_profile_secret");
});
