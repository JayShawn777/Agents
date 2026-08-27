import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0011 (B33). `lib/grading/grade.ts`'s composition, with
 * `requirePracticeAnswerKey` and `adjudicate` mocked — the pure decision
 * table this module exists to encode. `lib/grading/normalize.test.ts` and
 * `lib/grading/adjudicate.test.ts` cover the two stages' own internals; this
 * file covers ONLY how `grade.ts` wires them together and what it decides
 * when neither stage can.
 */

const requirePracticeAnswerKeyMock = vi.fn();
vi.mock("@/lib/auth/dal", () => ({ requirePracticeAnswerKey: requirePracticeAnswerKeyMock }));

const adjudicateMock = vi.fn();
vi.mock("@/lib/grading/adjudicate", () => ({ adjudicate: adjudicateMock }));

const { gradeSubmission } = await import("@/lib/grading/grade");

const FACTS = { gradeLevel: "GRADE_4", subject: "MATH" } as const;

function baseArgs(overrides: Partial<Parameters<typeof gradeSubmission>[0]> = {}) {
  return {
    practiceProblemId: "prob_1",
    submittedAnswer: "1/2",
    answerFormat: "FRACTION" as const,
    problemText: "What is $1/4 + 1/4$?",
    facts: FACTS,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePracticeAnswerKeyMock.mockResolvedValue({
    practiceProblemId: "prob_1",
    canonicalAnswer: "1/2",
    acceptedForms: ["0.5"],
    workedSolution: "Add the numerators: 1/4 + 1/4 = 2/4 = 1/2.",
  });
});

describe("gradeSubmission — stage one decides (NORMALIZER), no model call", () => {
  it("CORRECT: a decidable, matching answer never calls adjudicate", async () => {
    const outcome = await gradeSubmission(baseArgs({ submittedAnswer: "0.5" }));
    expect(outcome).toEqual({ result: "CORRECT", gradedBy: "NORMALIZER", hint: null, message: "That's correct!" });
    expect(adjudicateMock).not.toHaveBeenCalled();
  });

  it("INCORRECT: a decidable, non-matching answer never calls adjudicate", async () => {
    const outcome = await gradeSubmission(baseArgs({ submittedAnswer: "1/3" }));
    expect(outcome.result).toBe("INCORRECT");
    expect(outcome.gradedBy).toBe("NORMALIZER");
    expect(outcome.hint).toBeNull();
    expect(adjudicateMock).not.toHaveBeenCalled();
  });
});

describe("gradeSubmission — stage two (MODEL) only on a stage-one miss", () => {
  it("CORRECT via the model, for an answer format the normaliser can't parse", async () => {
    adjudicateMock.mockResolvedValue({ outcome: "CORRECT", hint: "n/a" });
    const outcome = await gradeSubmission(
      baseArgs({ submittedAnswer: "2(x+1)", answerFormat: "EXPRESSION", problemText: "Expand 2(x+1)." }),
    );
    expect(outcome.result).toBe("CORRECT");
    expect(outcome.gradedBy).toBe("MODEL");
    expect(adjudicateMock).toHaveBeenCalledOnce();
  });

  it("INCORRECT via the model carries the model's (post-checked) hint", async () => {
    adjudicateMock.mockResolvedValue({ outcome: "INCORRECT", hint: "Try distributing the 2 first." });
    const outcome = await gradeSubmission(
      baseArgs({ submittedAnswer: "2x+1", answerFormat: "EXPRESSION", problemText: "Expand 2(x+1)." }),
    );
    expect(outcome.result).toBe("INCORRECT");
    expect(outcome.gradedBy).toBe("MODEL");
    expect(outcome.hint).toBe("Try distributing the 2 first.");
  });
});

describe("gradeSubmission — the third outcome: UNSCORED, distinguishable from wrong everywhere it is stored", () => {
  it("the model's own UNSURE verdict becomes UNSCORED/UNGRADED, never INCORRECT", async () => {
    adjudicateMock.mockResolvedValue({ outcome: "UNSURE" });
    const outcome = await gradeSubmission(
      baseArgs({ submittedAnswer: "something ambiguous", answerFormat: "EXPRESSION" }),
    );
    expect(outcome.result).toBe("UNSCORED");
    expect(outcome.gradedBy).toBe("UNGRADED");
    expect(outcome.hint).toBeNull();
  });

  it("a refusal / null parse / timeout / any upstream failure ALSO becomes UNSCORED — an outage degrades to 'nothing judged', never an error surfaced as wrong", async () => {
    adjudicateMock.mockResolvedValue({ outcome: "UPSTREAM_FAILURE" });
    const outcome = await gradeSubmission(baseArgs({ submittedAnswer: "x", answerFormat: "EXPRESSION" }));
    expect(outcome.result).toBe("UNSCORED");
    expect(outcome.gradedBy).toBe("UNGRADED");
  });

  it("a missing answer key (a data invariant violation) is ALSO UNSCORED, never thrown to the student", async () => {
    requirePracticeAnswerKeyMock.mockResolvedValue(null);
    const outcome = await gradeSubmission(baseArgs());
    expect(outcome.result).toBe("UNSCORED");
    expect(outcome.gradedBy).toBe("UNGRADED");
  });

  it("AC 14: the UNSCORED message never says the student is wrong", async () => {
    adjudicateMock.mockResolvedValue({ outcome: "UNSURE" });
    const outcome = await gradeSubmission(baseArgs({ submittedAnswer: "x", answerFormat: "EXPRESSION" }));
    expect(outcome.message.toLowerCase()).not.toContain("wrong");
    expect(outcome.message.toLowerCase()).not.toContain("incorrect");
  });

  it("STRUCTURAL: UNSCORED's (result, gradedBy) pair never coincides with INCORRECT's or CORRECT's — distinguishable at the type/value level everywhere Attempt rows are stored or read", async () => {
    adjudicateMock.mockResolvedValue({ outcome: "UNSURE" });
    const unscored = await gradeSubmission(baseArgs({ submittedAnswer: "x", answerFormat: "EXPRESSION" }));
    const incorrect = await gradeSubmission(baseArgs({ submittedAnswer: "1/3" }));
    const correct = await gradeSubmission(baseArgs({ submittedAnswer: "0.5" }));

    const seen = new Set([
      `${unscored.result}:${unscored.gradedBy}`,
      `${incorrect.result}:${incorrect.gradedBy}`,
      `${correct.result}:${correct.gradedBy}`,
    ]);
    expect(seen.size).toBe(3);
    expect(unscored.result).not.toBe("INCORRECT");
    expect(unscored.gradedBy).not.toBe("NORMALIZER");
    expect(unscored.gradedBy).not.toBe("MODEL");
  });
});
