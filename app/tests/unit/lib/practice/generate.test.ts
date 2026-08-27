import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";

/**
 * `lib/practice/generate.ts` (B28, ADR-0009). Mirrors
 * `tests/unit/lib/extraction/run-extraction.test.ts`'s shape: mocked `db`
 * and mocked Anthropic client, testing the FAILURE branches specifically
 * (M2 AC 3/5/6) plus the two M2-specific ones (AC 2's non-identity check and
 * ADR-0009 §4's `SLATE_EMPTY`).
 */

const dbMock = {
  practiceSet: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  practiceProblem: {
    createManyAndReturn: vi.fn(),
  },
  practiceAnswerKey: {
    createMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const parseMock = vi.fn();
const getAnthropicClientMock = vi.fn(() => ({ messages: { parse: parseMock } }));

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return { ...actual, getAnthropicClient: getAnthropicClientMock };
});

const { runPracticeGeneration, reapIfStalePracticeSet } = await import("@/lib/practice/generate");

const PRACTICE_SET_ID = "set_1";

function baseSet(overrides: Record<string, unknown> = {}) {
  return {
    id: PRACTICE_SET_ID,
    status: "GENERATING",
    generationAttempts: 0,
    startedAt: null,
    studentProfile: { gradeLevel: "GRADE_4" },
    extraction: {
      problems: [
        { id: "ep_1", ordinal: 1, subject: "MATH", text: "What is 1/4 + 1/4?" },
        { id: "ep_2", ordinal: 2, subject: "MATH", text: "What is 2 x 3?" },
      ],
    },
    ...overrides,
  };
}

function validGeneratedProblem(overrides: Record<string, unknown> = {}) {
  return {
    skillCode: "4.NF.B.3",
    text: "What is 1/3 + 1/3?",
    containsMath: true,
    answerFormat: "FRACTION",
    choices: [],
    canonicalAnswer: "2/3",
    acceptedForms: [],
    workedSolution: "Add the numerators: 1/3 + 1/3 = 2/3.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.practiceSet.findUnique.mockResolvedValue(baseSet());
  dbMock.practiceSet.update.mockResolvedValue(baseSet());
  dbMock.practiceProblem.createManyAndReturn.mockImplementation(async ({ data }: { data: { skillCode: string }[] }) =>
    data.map((row, index) => ({ id: `pp_${index + 1}`, ...row })),
  );
  dbMock.practiceAnswerKey.createMany.mockResolvedValue({ count: 0 });
  getAnthropicClientMock.mockImplementation(() => ({ messages: { parse: parseMock } }));
});

describe("runPracticeGeneration — transitions and SKIPPED", () => {
  it("stamps startedAt and increments generationAttempts before calling the model", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { problems: Array.from({ length: 6 }, (_, i) => validGeneratedProblem({ text: `New problem ${i}` })) },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await runPracticeGeneration(PRACTICE_SET_ID);

    expect(dbMock.practiceSet.update).toHaveBeenCalledWith({
      where: { id: PRACTICE_SET_ID },
      data: { startedAt: expect.any(Date), generationAttempts: { increment: 1 } },
    });
  });

  it("SKIPs a row that is not GENERATING (a racing duplicate trigger)", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(baseSet({ status: "READY" }));
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "SKIPPED" });
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("runPracticeGeneration — SLATE_EMPTY (ADR-0009 §4), zero AI calls", () => {
  it("no gradeLevel yet -> SLATE_EMPTY, no AI call", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(baseSet({ studentProfile: { gradeLevel: null } }));
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "SLATE_EMPTY" });
    expect(parseMock).not.toHaveBeenCalled();
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
  });

  /**
   * This case used to assert READING -> SLATE_EMPTY. That was the bug, not the
   * contract: the bundle carried 18 ELA skills that READING never reached
   * because a hand-written `GRADABLE_SUBJECTS` excluded it. READING is now
   * gradable (see the positive case below); the SLATE_EMPTY path is still
   * exercised, using a subject the bundle genuinely does not cover.
   */
  it("no gradable source problems (all FOREIGN_LANGUAGE) -> SLATE_EMPTY, no AI call", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(
      baseSet({
        extraction: { problems: [{ id: "ep_1", ordinal: 1, subject: "FOREIGN_LANGUAGE", text: "Conjuga el verbo." }] },
      }),
    );
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "SLATE_EMPTY" });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("a problem with no subject at all -> SLATE_EMPTY, no AI call", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(
      baseSet({ extraction: { problems: [{ id: "ep_1", ordinal: 1, subject: null, text: "???" }] } }),
    );
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "SLATE_EMPTY" });
    expect(parseMock).not.toHaveBeenCalled();
  });

  /**
   * The positive half of the coverage fix. This app is not a math app — a
   * reading, science or social-studies worksheet must reach the model and come
   * back with practice, and each must be constrained to ITS OWN framework's
   * codes. Each case below would have failed as SLATE_EMPTY before the
   * taxonomy carried four frameworks and gradability was derived from them.
   */
  it.each([
    { subject: "READING", skillCode: "4.RI.3", text: "What is the main idea of the second paragraph?" },
    { subject: "WRITING", skillCode: "4.W.1", text: "Write an opinion paragraph with two reasons." },
    { subject: "SCIENCE", skillCode: "4-PS3-1", text: "Which ball has more energy, and how do you know?" },
    { subject: "SOCIAL_STUDIES", skillCode: "D2.His.1.3-5", text: "Put these three events in order." },
    { subject: "HISTORY", skillCode: "D2.His.1.3-5", text: "Why is this event considered significant?" },
  ])("generates practice for a $subject worksheet", async ({ subject, skillCode, text }) => {
    dbMock.practiceSet.findUnique.mockResolvedValue(
      baseSet({ extraction: { problems: [{ id: "ep_1", ordinal: 1, subject, text }] } }),
    );
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        problems: Array.from({ length: 6 }, (_, i) =>
          validGeneratedProblem({
            skillCode,
            text: `${subject} practice ${i}`,
            containsMath: false,
            answerFormat: "SHORT_TEXT",
            canonicalAnswer: `answer ${i}`,
          }),
        ),
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await runPracticeGeneration(PRACTICE_SET_ID);

    expect(result).toEqual({ status: "READY", problemCount: 6 });
    expect(parseMock).toHaveBeenCalledTimes(1);
  });

  it("a grade level outside the bundled K-8 taxonomy -> SLATE_EMPTY, no AI call", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(baseSet({ studentProfile: { gradeLevel: "ADULT_LEARNER" } }));
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "SLATE_EMPTY" });
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("runPracticeGeneration — failure branches", () => {
  it("a refusal lands FAILED/REFUSED with zero rows written", async () => {
    parseMock.mockResolvedValue({ stop_reason: "refusal", parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "REFUSED" });
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
    expect(dbMock.practiceAnswerKey.createMany).not.toHaveBeenCalled();
  });

  it("a null parsed_output lands FAILED/PARSE_FAILED with zero rows written", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("a connection timeout lands FAILED/TIMEOUT", async () => {
    parseMock.mockRejectedValue(new APIConnectionTimeoutError());
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "TIMEOUT" });
  });

  it("any other typed Anthropic API error lands FAILED/UPSTREAM, not TIMEOUT", async () => {
    parseMock.mockRejectedValue(new APIConnectionError({ message: "network down" }));
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "UPSTREAM" });
  });

  it("M2 AC 2: a generated problem identical to its source text fails the WHOLE set (zero rows), not just that one problem", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        problems: [
          validGeneratedProblem({ text: "What is 1/4 + 1/4?" }), // IDENTICAL to source ep_1
          ...Array.from({ length: 5 }, (_, i) => validGeneratedProblem({ text: `Fresh problem ${i}` })),
        ],
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("a case/whitespace-only difference from the source still counts as identical (AC 2's actual failure mode, not defeated by trivial formatting)", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        problems: [
          validGeneratedProblem({ text: "  WHAT IS 1/4 + 1/4?  " }),
          ...Array.from({ length: 5 }, (_, i) => validGeneratedProblem({ text: `Fresh problem ${i}` })),
        ],
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await runPracticeGeneration(PRACTICE_SET_ID);
    expect(result).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
  });
});

describe("runPracticeGeneration — success", () => {
  it("READY with problemCount, and answer keys created for every problem in one transaction", async () => {
    const problems = Array.from({ length: 6 }, (_, i) => validGeneratedProblem({ text: `Fresh problem ${i}` }));
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { problems },
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const result = await runPracticeGeneration(PRACTICE_SET_ID);

    expect(result).toEqual({ status: "READY", problemCount: 6 });
    expect(dbMock.practiceProblem.createManyAndReturn).toHaveBeenCalledOnce();
    expect(dbMock.practiceAnswerKey.createMany).toHaveBeenCalledOnce();
    const answerKeyCall = dbMock.practiceAnswerKey.createMany.mock.calls[0][0] as { data: { practiceProblemId: string }[] };
    expect(answerKeyCall.data).toHaveLength(6);
  });

  it("each generated problem cycles through the gradable source problems for sourceExtractedProblemId (round-robin, AC 1)", async () => {
    const problems = Array.from({ length: 6 }, (_, i) => validGeneratedProblem({ text: `Fresh problem ${i}` }));
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { problems },
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    await runPracticeGeneration(PRACTICE_SET_ID);

    const createCall = dbMock.practiceProblem.createManyAndReturn.mock.calls[0][0] as {
      data: { sourceExtractedProblemId: string }[];
    };
    // Two source problems, six slots -> alternating ep_1/ep_2.
    expect(createCall.data.map((d) => d.sourceExtractedProblemId)).toEqual(["ep_1", "ep_2", "ep_1", "ep_2", "ep_1", "ep_2"]);
  });
});

describe("reapIfStalePracticeSet", () => {
  it("leaves a fresh GENERATING set untouched", async () => {
    const set = { id: "s1", status: "GENERATING", startedAt: new Date() } as never;
    const result = await reapIfStalePracticeSet(set);
    expect(result).toBe(set);
    expect(dbMock.practiceSet.updateMany).not.toHaveBeenCalled();
  });

  it("flips a stale GENERATING set to FAILED/TIMEOUT", async () => {
    dbMock.practiceSet.updateMany.mockResolvedValue({ count: 1 });
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const set = { id: "s1", status: "GENERATING", startedAt: staleDate } as never;
    const result = await reapIfStalePracticeSet(set);
    expect(result).toMatchObject({ status: "FAILED", failureCode: "TIMEOUT" });
  });
});
