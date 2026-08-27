import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/practice-problems/[problemId]/reveal/route.ts` (endpoint 33, ADR-0011 §5). */

const dalMock = {
  requirePracticeProblem: vi.fn(),
  requirePracticeAnswerKey: vi.fn(),
  verifySession: vi.fn(async () => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = { attempt: { update: vi.fn() } };
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST } = await import("@/app/api/practice-problems/[problemId]/reveal/route");

function req() {
  return new Request("http://localhost/api/practice-problems/prob_1/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
function ctx() {
  return { params: Promise.resolve({ problemId: "prob_1" }) };
}

function problem(overrides: Record<string, unknown> = {}) {
  return {
    id: "prob_1",
    attempts: [] as { id: string; result: string; revealed: boolean }[],
    practiceSet: { studentProfile: { status: "ACTIVE" } },
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
    workedSolution: "Add the numerators.",
  });
  dbMock.attempt.update.mockResolvedValue({});
});

it("404s cross-account / nonexistent problem", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(null);
  const res = await POST(req(), ctx());
  expect(res.status).toBe(404);
});

it("ADR-0011 §5: 409s BELOW the incorrect-attempt threshold — without this gate AC 17 is decorative", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({ attempts: [{ id: "a1", result: "INCORRECT", revealed: false }] }),
  );
  const res = await POST(req(), ctx());
  expect(res.status).toBe(409);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(false);
  // The canonical answer must not appear ANYWHERE in a 409 response body.
  expect(JSON.stringify(body)).not.toContain("1/2");
});

it("succeeds once the incorrect-attempt count reaches ATTEMPTS_BEFORE_REVEAL (3), and marks the latest attempt revealed", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({
      attempts: [
        { id: "a1", result: "INCORRECT", revealed: false },
        { id: "a2", result: "INCORRECT", revealed: false },
        { id: "a3", result: "INCORRECT", revealed: false },
      ],
    }),
  );
  const res = await POST(req(), ctx());
  const body = (await res.json()) as { data: { workedSolution: string; canonicalAnswer: string } };

  expect(res.status).toBe(200);
  expect(body.data.canonicalAnswer).toBe("1/2");
  expect(dbMock.attempt.update).toHaveBeenCalledWith({ where: { id: "a3" }, data: { revealed: true } });
});

it("is idempotent — calling it again once already revealed still succeeds and does not re-stamp an already-revealed attempt", async () => {
  dalMock.requirePracticeProblem.mockResolvedValue(
    problem({
      attempts: [
        { id: "a1", result: "INCORRECT", revealed: false },
        { id: "a2", result: "INCORRECT", revealed: false },
        { id: "a3", result: "INCORRECT", revealed: true },
      ],
    }),
  );
  const res = await POST(req(), ctx());
  expect(res.status).toBe(200);
  expect(dbMock.attempt.update).not.toHaveBeenCalled();
});
