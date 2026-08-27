import { describe, expect, it } from "vitest";

import {
  toAttemptDTO,
  toFeedbackDTO,
  toPracticeProblemDTO,
  toPracticeSetDTO,
  toPracticeSetSummaryDTO,
  toSkillMasteryDTO,
} from "@/lib/practice/dto";

/**
 * ADR-0011 §5 / M2 AC 17, the non-negotiable this milestone names explicitly:
 * "An answer key must never reach a client... Add a test that fails if a key
 * ever appears in a DTO or a response body — this is a homework app."
 *
 * Two properties, both regressions this suite would actually catch:
 *   1. `PracticeProblemDTO`'s key set never contains `canonicalAnswer` or
 *      `acceptedForms`, structurally — not merely "doesn't today".
 *   2. `toPracticeProblemDTO` nulls `workedSolution`/`workedSolutionHtml`
 *      even when the input row's `answerKey.workedSolution` IS populated,
 *      as long as `revealed` is false. This is the actual regression AC 17
 *      is about (a row that carries the secret pre-reveal because of how it
 *      was queried), not a snapshot of today's happy-path output.
 */

const CANONICAL_ANSWER = "the-secret-canonical-answer";
const WORKED_SOLUTION = "Step 1: do the thing. The answer is " + CANONICAL_ANSWER + ".";

function baseProblem(overrides: Partial<Parameters<typeof toPracticeProblemDTO>[0]> = {}) {
  return {
    id: "prob_1",
    practiceSetId: "set_1",
    ordinal: 1,
    sourceExtractedProblemId: null,
    skillCode: "4.NF.B.3",
    text: "What is $1/2 + 1/4$?",
    containsMath: true,
    answerFormat: "FRACTION" as const,
    choices: [] as string[],
    difficultyOffset: 0,
    createdAt: new Date(),
    attempts: [] as { revealed: boolean; result: "CORRECT" | "INCORRECT" | "UNSCORED" }[],
    answerKey: null as { workedSolution: string } | null,
    ...overrides,
  };
}

describe("toPracticeProblemDTO — the answer key never reaches the DTO (M2 AC 17, ADR-0011 §5)", () => {
  it("REGRESSION: nulls workedSolution when NOT revealed, even though the input row's answerKey.workedSolution IS populated", () => {
    // This is exactly the shape `requirePracticeSet` can produce: the row's
    // answerKey.workedSolution is populated (it always is, once a set is
    // generated), and revealed is false until the reveal gate is passed.
    const row = baseProblem({
      attempts: [{ revealed: false, result: "INCORRECT" }, { revealed: false, result: "INCORRECT" }],
      answerKey: { workedSolution: WORKED_SOLUTION },
    });

    const dto = toPracticeProblemDTO(row);

    expect(dto.revealed).toBe(false);
    expect(dto.workedSolution).toBeNull();
    expect(dto.workedSolutionHtml).toBeNull();
    // Belt and braces: the secret string must not appear ANYWHERE in the
    // serialised DTO before reveal.
    expect(JSON.stringify(dto)).not.toContain(CANONICAL_ANSWER);
    expect(JSON.stringify(dto)).not.toContain(WORKED_SOLUTION);
  });

  it("reveals workedSolution only once an attempt on this problem is marked revealed", () => {
    const row = baseProblem({
      attempts: [{ revealed: false, result: "INCORRECT" }, { revealed: true, result: "INCORRECT" }],
      answerKey: { workedSolution: WORKED_SOLUTION },
    });

    const dto = toPracticeProblemDTO(row);

    expect(dto.revealed).toBe(true);
    expect(dto.workedSolution).toBe(WORKED_SOLUTION);
    expect(dto.workedSolutionHtml).toContain(CANONICAL_ANSWER);
  });

  it("STRUCTURAL: the DTO's key set never includes canonicalAnswer or acceptedForms, in any state", () => {
    const preReveal = toPracticeProblemDTO(baseProblem({ attempts: [], answerKey: null }));
    const postReveal = toPracticeProblemDTO(
      baseProblem({ attempts: [{ revealed: true, result: "INCORRECT" }], answerKey: { workedSolution: WORKED_SOLUTION } }),
    );

    for (const dto of [preReveal, postReveal]) {
      expect(Object.keys(dto).sort()).toEqual(
        [
          "answerFormat",
          "attemptCount",
          "choices",
          "containsMath",
          "id",
          "ordinal",
          "revealed",
          "skillCode",
          "skillDescriptor",
          "skillGradeLevel",
          "text",
          "textHtml",
          "workedSolution",
          "workedSolutionHtml",
        ].sort(),
      );
      expect(dto).not.toHaveProperty("canonicalAnswer");
      expect(dto).not.toHaveProperty("acceptedForms");
    }
  });

  it("falls back to a neutral descriptor for an unresolvable skill code, and logs rather than throwing", () => {
    const dto = toPracticeProblemDTO(baseProblem({ skillCode: "9.NOPE.NOT.REAL" }));
    expect(dto.skillDescriptor).toBe("this skill");
  });
});

describe("AttemptDTO — exact key set (never gradedBy or appliedToMasteryAt)", () => {
  it("matches the DTO contract exactly", () => {
    const dto = toAttemptDTO({
      id: "att_1",
      practiceProblemId: "prob_1",
      studentProfileId: "sp_1",
      attemptNumber: 1,
      submittedAnswer: "1/2",
      result: "CORRECT",
      gradedBy: "NORMALIZER",
      hint: null,
      revealed: false,
      elapsedMs: null,
      appliedToMasteryAt: new Date(),
      createdAt: new Date(),
    });
    expect(Object.keys(dto).sort()).toEqual(
      ["attemptNumber", "createdAt", "id", "practiceProblemId", "result", "submittedAnswer"].sort(),
    );
  });
});

describe("SkillMasteryDTO — exact key set (M2 AC 20)", () => {
  it("never carries correctCount, consecutiveCorrect, modelGradedCount or streakStartPracticeSetId", () => {
    const dto = toSkillMasteryDTO({
      id: "sm_1",
      studentProfileId: "sp_1",
      skillCode: "4.NF.B.3",
      attemptCount: 12,
      correctCount: 9,
      consecutiveCorrect: 6,
      streakStartPracticeSetId: "set_1",
      modelGradedCount: 2,
      level: "SECURE",
      levelReachedAt: new Date(),
      lastPracticedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(Object.keys(dto).sort()).toEqual(
      ["lastPracticedAt", "level", "problemsPracticed", "skillCode", "skillDescriptor"].sort(),
    );
    expect(dto.problemsPracticed).toBe(12);
  });
});

describe("toFeedbackDTO", () => {
  it("computes retryOffered and revealAvailable from the attempts-remaining count", () => {
    const dto = toFeedbackDTO({
      result: "INCORRECT",
      message: "Not quite.",
      hint: "Think about the denominators.",
      attemptsRemainingBeforeReveal: 0,
    });
    expect(dto.retryOffered).toBe(true);
    expect(dto.revealAvailable).toBe(true);
    expect(dto.attemptsRemainingBeforeReveal).toBe(0);
  });

  it("CORRECT never offers a retry", () => {
    const dto = toFeedbackDTO({ result: "CORRECT", message: "Correct!", hint: null, attemptsRemainingBeforeReveal: 2 });
    expect(dto.retryOffered).toBe(false);
  });
});

describe("toPracticeSetDTO", () => {
  it("computes answeredCount and resumeOrdinal from problems/attempts, never storing them", () => {
    const dto = toPracticeSetDTO({
      id: "set_1",
      kind: "PRACTICE",
      extractionId: "ext_1",
      status: "READY",
      failureCode: null,
      createdAt: new Date(),
      finishedAt: null,
      problems: [
        { ordinal: 1, attempts: [{ id: "a1" }] },
        { ordinal: 2, attempts: [] },
        { ordinal: 3, attempts: [] },
      ],
    });
    expect(dto.problemCount).toBe(3);
    expect(dto.answeredCount).toBe(1);
    expect(dto.resumeOrdinal).toBe(2);
  });

  it("resumeOrdinal is null once every problem has an attempt", () => {
    const dto = toPracticeSetDTO({
      id: "set_1",
      kind: "PRACTICE",
      extractionId: "ext_1",
      status: "IN_PROGRESS",
      failureCode: null,
      createdAt: new Date(),
      finishedAt: null,
      problems: [{ ordinal: 1, attempts: [{ id: "a1" }] }],
    });
    expect(dto.resumeOrdinal).toBeNull();
  });

  it("maps an unrecognized failureCode to the generic internal-error message, never verbatim", () => {
    const dto = toPracticeSetDTO({
      id: "set_1",
      kind: "PRACTICE",
      extractionId: "ext_1",
      status: "FAILED",
      failureCode: "something-a-future-bug-invented",
      createdAt: new Date(),
      finishedAt: null,
      problems: [],
    });
    expect(dto.failureMessage).toBe("Something went wrong on our end. Please try again.");
  });
});

describe("toPracticeSetSummaryDTO (AC 21)", () => {
  it("counts only answered problems, grouped by skill, with a progress-framed message", () => {
    const summary = toPracticeSetSummaryDTO([
      baseProblem({ ordinal: 1, skillCode: "4.NF.B.3", attempts: [{ revealed: false, result: "INCORRECT" }] }),
      baseProblem({ ordinal: 2, skillCode: "4.NF.B.3", attempts: [{ revealed: false, result: "INCORRECT" }] }),
      baseProblem({ ordinal: 3, skillCode: "4.OA.A.1", attempts: [] }),
    ]);
    expect(summary.totalAnswered).toBe(2);
    expect(summary.skills).toEqual([{ skillCode: "4.NF.B.3", skillDescriptor: expect.any(String), problemsAnswered: 2 }]);
    expect(summary.message.length).toBeGreaterThan(0);
    // AC 21 / AC 20: no score, no percentage, no mark in the summary shape.
    expect(Object.keys(summary).sort()).toEqual(["message", "skills", "totalAnswered", "totalCorrect"].sort());
  });
});

// ─────────────── ADR-0017: the kind discriminator ───────────────

it("carries `kind` through to the DTO — the client renders a checkpoint differently", () => {
  const dto = toPracticeSetDTO({
    id: "set_1",
    kind: "CHECKPOINT",
    extractionId: null,
    status: "READY",
    failureCode: null,
    createdAt: new Date(),
    finishedAt: null,
    problems: [{ ordinal: 1, attempts: [] }],
  });

  expect(dto.kind).toBe("CHECKPOINT");
  expect(dto.extractionId).toBeNull();
});

// ─────────────── M2.5 AC 12: the checkpoint result's numerator ───────────────

it("counts a problem as right when any attempt on it was CORRECT", () => {
  const summary = toPracticeSetSummaryDTO([
    baseProblem({ ordinal: 1, attempts: [{ revealed: false, result: "CORRECT" }] }),
    baseProblem({ ordinal: 2, attempts: [{ revealed: false, result: "INCORRECT" }] }),
    // Got there on the second try. Counting this as wrong would punish a
    // student for having tried twice, which practice explicitly invites.
    baseProblem({
      ordinal: 3,
      attempts: [
        { revealed: false, result: "INCORRECT" },
        { revealed: false, result: "CORRECT" },
      ],
    }),
  ]);

  expect(summary.totalAnswered).toBe(3);
  expect(summary.totalCorrect).toBe(2);
});

it("an UNSCORED attempt is not counted right — it is evidence in neither direction", () => {
  const summary = toPracticeSetSummaryDTO([
    baseProblem({ ordinal: 1, attempts: [{ revealed: false, result: "UNSCORED" }] }),
  ]);

  expect(summary.totalAnswered).toBe(1);
  expect(summary.totalCorrect).toBe(0);
});

it("an unanswered problem counts toward neither total", () => {
  const summary = toPracticeSetSummaryDTO([
    baseProblem({ ordinal: 1, attempts: [{ revealed: false, result: "CORRECT" }] }),
    baseProblem({ ordinal: 2, attempts: [] }),
  ]);

  expect(summary.totalAnswered).toBe(1);
  expect(summary.totalCorrect).toBe(1);
});
