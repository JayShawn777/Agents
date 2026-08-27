import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/practice-problems/[problemId]/attempts/route.ts` (endpoint 32). */

const dalMock = {
  requirePracticeProblem: vi.fn(),
  requirePracticeAnswerKey: vi.fn(),
  verifySession: vi.fn(async () => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  attempt: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  skillMastery: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  practiceSet: { updateMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST } = await import("@/app/api/practice-problems/[problemId]/attempts/route");

function req(body: unknown) {
  return new Request("http://localhost/api/practice-problems/prob_1/attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function ctx() {
  return { params: Promise.resolve({ problemId: "prob_1" }) };
}

function problem(overrides: Record<string, unknown> = {}) {
  return {
    id: "prob_1",
    practiceSetId: "set_1",
    skillCode: "4.NF.B.3",
    text: "What is 1/4 + 1/4?",
    answerFormat: "FRACTION",
    attempts: [] as { revealed: boolean; result: string }[],
    practiceSet: { id: "set_1", status: "READY", studentProfileId: "sp_1", studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requirePracticeAnswerKey.mockResolvedValue({
    practiceProblemId: "prob_1",
    canonicalAnswer: "1/2",
    acceptedForms: [],
    workedSolution: "step",
  });
  dbMock.attempt.count.mockResolvedValue(0);
  dbMock.attempt.updateMany.mockResolvedValue({ count: 1 });
  dbMock.attempt.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "att_1",
    createdAt: new Date(),
    ...data,
  }));
  dbMock.skillMastery.findUnique.mockResolvedValue(null);
  dbMock.skillMastery.upsert.mockResolvedValue({});
  dbMock.skillMastery.updateMany.mockResolvedValue({ count: 0 });
  dbMock.practiceSet.updateMany.mockResolvedValue({ count: 0 });
});

it("404s cross-account / nonexistent problem", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(null);
  const res = await POST(req({ answer: "1/2" }), ctx());
  expect(res.status).toBe(404);
});

it("403s a non-ACTIVE profile, before the body would even matter", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({ practiceSet: { id: "set_1", status: "READY", studentProfileId: "sp_1", studentProfile: { status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } } }),
  );
  const res = await POST(req({ answer: "1/2" }), ctx());
  expect(res.status).toBe(403);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("409s against a GENERATING or FAILED set", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({ practiceSet: { id: "set_1", status: "FAILED", studentProfileId: "sp_1", studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" } } }),
  );
  const res = await POST(req({ answer: "1/2" }), ctx());
  expect(res.status).toBe(409);
});

it("M2 AC 15: an empty answer is a 400 and creates NO attempt row", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(problem());
  const res = await POST(req({ answer: "   " }), ctx());
  expect(res.status).toBe(400);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("M2 AC 16: an over-length answer is a 400", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(problem());
  const res = await POST(req({ answer: "9".repeat(501) }), ctx());
  expect(res.status).toBe(400);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("M2 AC 10: a correct, decidable answer creates an attempt row and never calls the model", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(problem());
  const res = await POST(req({ answer: "0.5" }), ctx());
  const body = (await res.json()) as { data: { attempt: { result: string }; feedback: { result: string } } };

  expect(res.status).toBe(201);
  expect(body.data.attempt.result).toBe("CORRECT");
  expect(body.data.feedback.result).toBe("CORRECT");
  expect(dbMock.attempt.create).toHaveBeenCalledOnce();
});

it("M2 AC 10: a second attempt on the same problem creates a SECOND row (attemptNumber 2), never overwriting the first", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({ attempts: [{ revealed: false, result: "INCORRECT" }] }),
  );
  dbMock.attempt.count.mockResolvedValue(1);
  await POST(req({ answer: "1/3" }), ctx());
  expect(dbMock.attempt.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ attemptNumber: 2 }) }),
  );
});
