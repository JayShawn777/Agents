import { beforeEach, describe, expect, it, vi } from "vitest";

/** `app/api/extractions/[extractionId]/problems/[problemId]/route.ts` (endpoints 22-23, M1 AC 28/29/33). */

const dalMock = { requireExtraction: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  extractedProblem: { update: vi.fn(), delete: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { PATCH, DELETE } = await import("@/app/api/extractions/[extractionId]/problems/[problemId]/route");

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/extractions/extraction_1/problems/p1", {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
function ctx(problemId = "p1") {
  return { params: Promise.resolve({ extractionId: "extraction_1", problemId }) };
}

function extractionWithProblems() {
  return {
    id: "extraction_1",
    problems: [
      { id: "p1", ordinal: 1, text: "old text", studentCorrected: false },
      { id: "p2", ordinal: 2, text: "other", studentCorrected: false },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireExtraction.mockResolvedValue(extractionWithProblems());
});

describe("PATCH (M1 AC 28)", () => {
  it("404s a problemId that belongs to a DIFFERENT extraction than the one owned/loaded", async () => {
    const res = await PATCH(req("PATCH", { text: "fixed" }), ctx("not-a-real-id"));
    expect(res.status).toBe(404);
    expect(dbMock.extractedProblem.update).not.toHaveBeenCalled();
  });

  it("persists the edit and marks the row student-corrected", async () => {
    dbMock.extractedProblem.update.mockResolvedValue({
      id: "p1",
      ordinal: 1,
      label: null,
      text: "fixed",
      containsMath: false,
      subject: null,
      problemType: null,
      studentAnswerText: null,
      confidence: 0.9,
      studentCorrected: true,
    });

    const res = await PATCH(req("PATCH", { text: "fixed" }), ctx());
    const body = (await res.json()) as { data: { problem: { text: string; studentCorrected: boolean } } };

    expect(res.status).toBe(200);
    expect(body.data.problem.text).toBe("fixed");
    expect(body.data.problem.studentCorrected).toBe(true);
    expect(dbMock.extractedProblem.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { text: "fixed", studentCorrected: true },
    });
  });
});

describe("DELETE (M1 AC 29 — ordinals of survivors are never renumbered)", () => {
  it("deletes only the targeted row", async () => {
    const res = await DELETE(req("DELETE"), ctx());
    const body = (await res.json()) as { data: { deleted: true } };

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(dbMock.extractedProblem.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    // The survivor (p2, ordinal 2) is never touched by this handler.
    expect(dbMock.extractedProblem.update).not.toHaveBeenCalled();
  });
});
