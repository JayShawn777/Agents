import { beforeEach, expect, it, vi } from "vitest";

import { ATTEMPTS_PER_HOUR, MAX_ATTEMPTS_PER_PROBLEM } from "@/lib/config";

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
    practiceSet: { id: "set_1", kind: "PRACTICE", status: "READY", studentProfileId: "sp_1", studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" } },
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
    problem({ practiceSet: { id: "set_1", kind: "PRACTICE", status: "READY", studentProfileId: "sp_1", studentProfile: { status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } } }),
  );
  const res = await POST(req({ answer: "1/2" }), ctx());
  expect(res.status).toBe(403);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("409s against a GENERATING or FAILED set", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({ practiceSet: { id: "set_1", kind: "PRACTICE", status: "FAILED", studentProfileId: "sp_1", studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" } } }),
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

// ─────────── the two caps added by the M2 review, 2026-08-27 ───────────

it("stops accepting answers at MAX_ATTEMPTS_PER_PROBLEM — 409, no attempt row, no model call", async () => {
  const spent = Array.from({ length: MAX_ATTEMPTS_PER_PROBLEM }, () => ({ revealed: true, result: "INCORRECT" }));
  dalMock.requirePracticeProblem.mockResolvedValue(problem({ attempts: spent }));

  const res = await POST(req({ answer: "1/2" }), ctx());

  expect(res.status).toBe(409);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("the last allowed attempt still goes through — the cap is a ceiling, not an off-by-one", async () => {
  const spent = Array.from({ length: MAX_ATTEMPTS_PER_PROBLEM - 1 }, () => ({ revealed: false, result: "INCORRECT" }));
  dalMock.requirePracticeProblem.mockResolvedValue(problem({ attempts: spent }));

  const res = await POST(req({ answer: "1/2" }), ctx());

  expect(res.status).toBe(201);
  expect(dbMock.attempt.create).toHaveBeenCalledOnce();
});

it("the 409 message never tells a child they failed — it points at the worked answer", async () => {
  const spent = Array.from({ length: MAX_ATTEMPTS_PER_PROBLEM }, () => ({ revealed: true, result: "INCORRECT" }));
  dalMock.requirePracticeProblem.mockResolvedValue(problem({ attempts: spent }));

  const res = await POST(req({ answer: "1/2" }), ctx());
  const body = (await res.json()) as { error: { message: string } };

  expect(body.error.message).toMatch(/good go/i);
  expect(body.error.message).not.toMatch(/fail|wrong|too many|error/i);
});

it("caps attempts per hour per student profile — 429 before the answer is even parsed", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(problem());
  dbMock.attempt.count.mockResolvedValue(ATTEMPTS_PER_HOUR);

  const res = await POST(req({ answer: "1/2" }), ctx());

  expect(res.status).toBe(429);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("the hourly cap counts THIS profile's attempts in a one-hour window, not every attempt ever", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(problem());
  await POST(req({ answer: "1/2" }), ctx());

  expect(dbMock.attempt.count).toHaveBeenCalledWith({
    where: { studentProfileId: "sp_1", createdAt: { gte: expect.any(Date) } },
  });
});

it("an unparseable answer submitted in a loop cannot outrun the cap — the abuse path the review found", async () => {
  // "x" against a FRACTION problem misses stage one deterministically, so every
  // one of these would reach Anthropic (ADR-0011 §2) if nothing bounded it.
  dalMock.requirePracticeProblem.mockResolvedValue(problem());
  dbMock.attempt.count.mockResolvedValue(ATTEMPTS_PER_HOUR + 500);

  const res = await POST(req({ answer: "x" }), ctx());

  expect(res.status).toBe(429);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

// ─────────── M2.5 AC 11: a checkpoint takes one answer per problem ───────────

function checkpointProblem(attempts: { revealed: boolean; result: string }[] = []) {
  return problem({
    attempts,
    practiceSet: {
      id: "set_1",
      kind: "CHECKPOINT",
      status: "IN_PROGRESS",
      studentProfileId: "sp_1",
      studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" },
    },
  });
}

it("accepts the FIRST answer to a checkpoint problem", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(checkpointProblem());
  const res = await POST(req({ answer: "0.5" }), ctx());

  expect(res.status).toBe(201);
  expect(dbMock.attempt.create).toHaveBeenCalledOnce();
});

it("refuses the SECOND answer to a checkpoint problem — one try each", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    checkpointProblem([{ revealed: false, result: "INCORRECT" }]),
  );
  const res = await POST(req({ answer: "0.5" }), ctx());

  expect(res.status).toBe(409);
  expect(dbMock.attempt.create).not.toHaveBeenCalled();
});

it("a practice problem still gets its full run of attempts — the cap is checkpoint-only", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({ attempts: [{ revealed: false, result: "INCORRECT" }] }),
  );
  expect((await POST(req({ answer: "0.5" }), ctx())).status).toBe(201);
});

it("the checkpoint refusal explains the checkpoint, and never says the child has had plenty of tries", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    checkpointProblem([{ revealed: false, result: "CORRECT" }]),
  );
  const body = (await (await POST(req({ answer: "0.5" }), ctx())).json()) as { error: { message: string } };

  expect(body.error.message).toMatch(/one try each/i);
  expect(body.error.message).not.toMatch(/good go|plenty|fail|wrong/i);
});

it("a set that is still GENERATING gets its own reason, not the attempt-cap copy", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({
      practiceSet: {
        id: "set_1",
        kind: "PRACTICE",
        status: "GENERATING",
        studentProfileId: "sp_1",
        studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" },
      },
    }),
  );
  const res = await POST(req({ answer: "0.5" }), ctx());
  const body = (await res.json()) as { error: { message: string } };

  expect(res.status).toBe(409);
  expect(body.error.message).toMatch(/isn't ready yet/i);
});
