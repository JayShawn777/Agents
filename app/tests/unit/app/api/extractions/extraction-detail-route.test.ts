import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/extractions/[extractionId]/route.ts` (endpoint 19, M1 AC 18/27). */

const dalMock = { requireExtraction: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const reapIfStaleMock = vi.fn(async (extraction: unknown) => extraction);
vi.mock("@/lib/extraction/run-extraction", () => ({ reapIfStale: reapIfStaleMock }));

const { GET } = await import("@/app/api/extractions/[extractionId]/route");

function req() {
  return new Request("http://localhost/api/extractions/extraction_1", { method: "GET" });
}
function ctx() {
  return { params: Promise.resolve({ extractionId: "extraction_1" }) };
}

function baseExtraction(overrides: Record<string, unknown> = {}) {
  return {
    id: "extraction_1",
    uploadId: "upload_1",
    status: "RUNNING",
    failureCode: null,
    completedAt: null,
    problems: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  reapIfStaleMock.mockImplementation(async (extraction: unknown) => extraction);
});

it("404s cross-account (M1 AC 33)", async () => {
  dalMock.requireExtraction.mockResolvedValue(null);
  const res = await GET(req(), ctx());
  expect(res.status).toBe(404);
});

it("reaps a stale RUNNING row and reports the reaped (FAILED) status to the client", async () => {
  dalMock.requireExtraction.mockResolvedValue(baseExtraction());
  reapIfStaleMock.mockResolvedValue(
    baseExtraction({ status: "FAILED", failureCode: "TIMEOUT", completedAt: new Date() }),
  );

  const res = await GET(req(), ctx());
  const body = (await res.json()) as { data: { extraction: { status: string; failureMessage: string | null } } };

  expect(res.status).toBe(200);
  expect(body.data.extraction.status).toBe("FAILED");
  expect(body.data.extraction.failureMessage).toMatch(/longer than expected/);
});

it("returns problems in ordinal order with lowConfidence flagged below the threshold", async () => {
  dalMock.requireExtraction.mockResolvedValue(
    baseExtraction({
      status: "COMPLETE",
      problems: [
        { id: "p1", ordinal: 1, label: null, text: "a", containsMath: false, subject: "MATH", problemType: "x", studentAnswerText: null, confidence: 0.95, studentCorrected: false },
        { id: "p2", ordinal: 2, label: null, text: "b", containsMath: false, subject: "MATH", problemType: "x", studentAnswerText: null, confidence: 0.4, studentCorrected: false },
      ],
    }),
  );

  const res = await GET(req(), ctx());
  const body = (await res.json()) as {
    data: { problems: Array<{ ordinal: number; lowConfidence: boolean }> };
  };

  expect(body.data.problems.map((p) => p.ordinal)).toEqual([1, 2]);
  expect(body.data.problems[0].lowConfidence).toBe(false);
  expect(body.data.problems[1].lowConfidence).toBe(true);
});
