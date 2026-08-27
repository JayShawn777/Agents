import { beforeEach, describe, expect, it, vi } from "vitest";

/** `lib/checkpoints/generate.ts` — M2.5 slice 5b. Mirrors the practice generator's test shape. */

const dbMock = {
  practiceSet: { findUnique: vi.fn(), update: vi.fn() },
  skillMastery: { findMany: vi.fn() },
  practiceProblem: { createManyAndReturn: vi.fn() },
  practiceAnswerKey: { createMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return arg;
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const parseMock = vi.fn();
vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return { ...actual, getAnthropicClient: () => ({ messages: { parse: parseMock } }) };
});

const { runCheckpointGeneration } = await import("@/lib/checkpoints/generate");
const { CHECKPOINT_SIZE } = await import("@/lib/config");

const SET_ID = "set_1";

/** Real codes from the bundled taxonomy, so `resolveSkill` is exercised rather than mocked. */
const REAL_CODES = ["K.CC.A.1", "K.OA.A.1", "K.NBT.A.1"];

function checkpointSet(overrides: Record<string, unknown> = {}) {
  return {
    id: SET_ID,
    kind: "CHECKPOINT",
    status: "GENERATING",
    studentProfileId: "sp_1",
    studentProfile: { gradeLevel: "KINDERGARTEN" },
    ...overrides,
  };
}

function mastery(codes: string[]) {
  return codes.map((skillCode, i) => ({
    skillCode,
    attemptCount: 3,
    lastPracticedAt: new Date(Date.UTC(2026, 0, 1 + i)),
  }));
}

function generated(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    skillCode: REAL_CODES[i % REAL_CODES.length],
    text: `Question ${i + 1}`,
    containsMath: false,
    answerFormat: "NUMERIC" as const,
    choices: [],
    canonicalAnswer: "4",
    acceptedForms: [],
    workedSolution: "Count them.",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.practiceSet.findUnique.mockResolvedValue(checkpointSet());
  dbMock.practiceSet.update.mockResolvedValue({});
  dbMock.skillMastery.findMany.mockResolvedValue(mastery(REAL_CODES));
  dbMock.practiceProblem.createManyAndReturn.mockImplementation(async ({ data }: { data: unknown[] }) =>
    data.map((_, i) => ({ id: `prob_${i}` })),
  );
  dbMock.practiceAnswerKey.createMany.mockResolvedValue({ count: 0 });
  parseMock.mockResolvedValue({
    stop_reason: "end_turn",
    parsed_output: { problems: generated(CHECKPOINT_SIZE) },
    usage: { input_tokens: 10, output_tokens: 20 },
  });
});

describe("guards before anything is spent", () => {
  it("SKIPPED when the set is no longer GENERATING — a racing trigger is not a second generation", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(checkpointSet({ status: "READY" }));
    expect(await runCheckpointGeneration(SET_ID)).toEqual({ status: "SKIPPED" });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("SKIPPED, loudly, when pointed at a PRACTICE set", async () => {
    dbMock.practiceSet.findUnique.mockResolvedValue(checkpointSet({ kind: "PRACTICE" }));
    expect(await runCheckpointGeneration(SET_ID)).toEqual({ status: "SKIPPED" });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("SLATE_EMPTY with no AI call when the student has too few practised skills", async () => {
    dbMock.skillMastery.findMany.mockResolvedValue(mastery(REAL_CODES.slice(0, 1)));
    const result = await runCheckpointGeneration(SET_ID);

    expect(result).toEqual({ status: "FAILED", failureCode: "SLATE_EMPTY" });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("SLATE_EMPTY when a mastery row names a skill the current taxonomy no longer carries", async () => {
    // `new Date(0)` makes the stale code the OLDEST practised, so composition
    // puts it first and the resolve check meets it immediately.
    dbMock.skillMastery.findMany.mockResolvedValue(
      mastery(REAL_CODES).concat([{ skillCode: "NOT.A.REAL.CODE", attemptCount: 3, lastPracticedAt: new Date(0) }]),
    );
    const result = await runCheckpointGeneration(SET_ID);

    expect(result).toEqual({ status: "FAILED", failureCode: "SLATE_EMPTY" });
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("the model's answer", () => {
  it("a refusal fails the set without writing a problem", async () => {
    parseMock.mockResolvedValue({ stop_reason: "refusal", parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    expect(await runCheckpointGeneration(SET_ID)).toEqual({ status: "FAILED", failureCode: "REFUSED" });
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("a null parse fails the set without writing a problem", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    expect(await runCheckpointGeneration(SET_ID)).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("an off-slate skillCode fails the WHOLE set — no partial checkpoint is written", async () => {
    const problems = generated(CHECKPOINT_SIZE);
    problems[2].skillCode = "NOT.A.REAL.CODE";
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { problems }, usage: { input_tokens: 1, output_tokens: 1 } });

    expect(await runCheckpointGeneration(SET_ID)).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
    expect(dbMock.practiceProblem.createManyAndReturn).not.toHaveBeenCalled();
  });
});

describe("a successful checkpoint", () => {
  it("writes every problem with no source problem and no difficulty offset", async () => {
    const result = await runCheckpointGeneration(SET_ID);

    expect(result).toEqual({ status: "READY", problemCount: CHECKPOINT_SIZE });
    const written = dbMock.practiceProblem.createManyAndReturn.mock.calls[0][0].data as {
      sourceExtractedProblemId: string | null;
      difficultyOffset: number;
    }[];
    expect(written).toHaveLength(CHECKPOINT_SIZE);
    expect(written.every((p) => p.sourceExtractedProblemId === null)).toBe(true);
    expect(written.every((p) => p.difficultyOffset === 0)).toBe(true);
  });

  it("writes an answer key per problem, in the same transaction", async () => {
    await runCheckpointGeneration(SET_ID);
    expect(dbMock.$transaction).toHaveBeenCalledOnce();
    expect(dbMock.practiceAnswerKey.createMany).toHaveBeenCalledOnce();
  });

  it("asks the oldest-practised skill first, so the prompt reflects the composition", async () => {
    await runCheckpointGeneration(SET_ID);
    const userPrompt = parseMock.mock.calls[0][0].messages[0].content as string;
    expect(userPrompt).toContain(`1. ${REAL_CODES[0]}`);
  });
});
