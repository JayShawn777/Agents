import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { toPracticeProblemDTO, toPracticeSetDTO } = await import("@/lib/practice/dto");

/**
 * `requirePracticeSet`'s query (`lib/auth/dal.ts`), reproduced here rather
 * than called directly: the real DAL function calls `verifySession()`,
 * which needs a live Auth.js request context this plain Vitest process
 * doesn't provide (every other test in this suite that touches the DAL
 * mocks `@/lib/auth/dal` entirely rather than calling it for real, for the
 * same reason). This is the SAME `include` shape as
 * `PracticeSetWithProblems` in `lib/auth/dal.ts` — the property under test
 * (canonicalAnswer/acceptedForms are never fetched) lives in the query
 * shape itself, not in `verifySession`'s auth check, which is exercised
 * separately by the mocked-`db` route tests.
 */
async function loadPracticeSetForOwner(practiceSetId: string) {
  return db.practiceSet.findFirst({
    where: { id: practiceSetId },
    include: {
      studentProfile: { select: { status: true } },
      problems: {
        orderBy: { ordinal: "asc" },
        include: {
          attempts: { orderBy: { attemptNumber: "asc" } },
          answerKey: { select: { workedSolution: true } },
        },
      },
    },
  });
}

/**
 * ADR-0011 §5 / M2 AC 17, end to end against the real database and the real
 * query the practice-set page runs — not a hand-built fixture object that
 * happens not to include the key. This is the closest this suite can get to
 * "the RSC path" without a full Next.js render: the exact DAL query shape,
 * the exact DTO builders, the exact payload shape the page hands to a
 * client component, serialised and inspected for the secret strings.
 */
describe("the answer key never reaches a serialised practice-set payload (M2 AC 17)", () => {
  const createdUserIds: string[] = [];
  // Deliberately distinct strings for the canonical answer, an accepted
  // form, and the worked solution — so each assertion below is unambiguous
  // about WHICH string it found (or didn't), rather than three overlapping
  // substrings of one another.
  const CANONICAL_ANSWER = "zzq-canonical-marker-9182";
  const ACCEPTED_FORM = "zzq-accepted-form-marker-2837";
  const WORKED_SOLUTION = "First combine the fractions, then simplify the result to reach the final value.";

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function makeFixture() {
    const user = await db.user.create({
      data: { email: `answer-key-leak-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);
    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/leak-${Date.now()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalFilename: "x.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });
    const set = await db.practiceSet.create({
      data: {
        studentProfileId: profile.id,
        extractionId: extraction.id,
        status: "READY",
        model: "claude-opus-5",
        effort: "high",
        promptVersion: "test",
        taxonomyVersion: "test",
      },
    });
    const problem = await db.practiceProblem.create({
      data: {
        practiceSetId: set.id,
        ordinal: 1,
        skillCode: "4.NF.B.3",
        text: "A secret-bearing test problem",
        answerFormat: "NUMERIC",
      },
    });
    await db.practiceAnswerKey.create({
      data: {
        practiceProblemId: problem.id,
        canonicalAnswer: CANONICAL_ANSWER,
        acceptedForms: [ACCEPTED_FORM],
        workedSolution: WORKED_SOLUTION,
      },
    });
    return { profile, set, problem };
  }

  it("PRE-reveal: the DATABASE QUERY never fetches canonicalAnswer/acceptedForms at all, and the DTO payload additionally withholds workedSolution", async () => {
    const { set } = await makeFixture();

    const setRow = await loadPracticeSetForOwner(set.id);
    expect(setRow).not.toBeNull();
    if (!setRow) throw new Error("fixture setup failed");

    // STRUCTURAL, at the database layer: `select: { workedSolution: true }`
    // means canonicalAnswer/acceptedForms were never fetched from Postgres
    // at all — not merely omitted from a later mapping step.
    const rawRowJson = JSON.stringify(setRow);
    expect(rawRowJson).not.toContain(CANONICAL_ANSWER);
    expect(rawRowJson).not.toContain(ACCEPTED_FORM);
    expect(setRow.problems[0].answerKey).not.toHaveProperty("canonicalAnswer");
    expect(setRow.problems[0].answerKey).not.toHaveProperty("acceptedForms");

    // The DTO layer (what the page actually hands to a client component):
    // withholds workedSolution too, pre-reveal.
    const problemDTOs = setRow.problems.map((p) => toPracticeProblemDTO(p));
    const fullPagePayload = { set: toPracticeSetDTO(setRow), problems: problemDTOs };
    const serialized = JSON.stringify(fullPagePayload);

    expect(serialized).not.toContain(CANONICAL_ANSWER);
    expect(serialized).not.toContain(ACCEPTED_FORM);
    expect(serialized).not.toContain(WORKED_SOLUTION);
    expect(problemDTOs[0].revealed).toBe(false);
    expect(problemDTOs[0].workedSolution).toBeNull();
  });

  it("POST-reveal: the DTO payload exposes workedSolution, but the canonical answer and its accepted forms remain absent (never fetched, never a DTO field)", async () => {
    const { set, problem } = await makeFixture();
    const practiceSet = await db.practiceSet.findUniqueOrThrow({ where: { id: set.id } });

    await db.attempt.create({
      data: {
        practiceProblemId: problem.id,
        studentProfileId: practiceSet.studentProfileId,
        attemptNumber: 1,
        submittedAnswer: "wrong",
        result: "INCORRECT",
        gradedBy: "NORMALIZER",
        revealed: true,
      },
    });

    const setRow = await loadPracticeSetForOwner(set.id);
    if (!setRow) throw new Error("fixture setup failed");
    const problemDTOs = setRow.problems.map((p) => toPracticeProblemDTO(p));
    const serialized = JSON.stringify({ set: toPracticeSetDTO(setRow), problems: problemDTOs });

    expect(problemDTOs[0].revealed).toBe(true);
    expect(problemDTOs[0].workedSolution).toBe(WORKED_SOLUTION);
    expect(serialized).toContain(WORKED_SOLUTION);
    // Still absent — the raw row never carried them, and PracticeProblemDTO
    // has no such field at all (asserted exactly in
    // tests/unit/lib/practice/dto.test.ts's exact-key-set test).
    expect(serialized).not.toContain(CANONICAL_ANSWER);
    expect(serialized).not.toContain(ACCEPTED_FORM);
  });
});
