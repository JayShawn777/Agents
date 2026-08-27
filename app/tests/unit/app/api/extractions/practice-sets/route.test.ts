import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/extractions/[extractionId]/practice-sets/route.ts` (endpoint 29). */

const dalMock = { requireExtraction: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: afterMock }));

const dbMock = { practiceSet: { create: vi.fn(), count: vi.fn() } };
vi.mock("@/lib/db", () => ({ db: dbMock }));

const runPracticeGenerationMock = vi.fn(async () => ({ status: "SKIPPED" as const }));
vi.mock("@/lib/practice/generate", () => ({ runPracticeGeneration: runPracticeGenerationMock }));

const { POST } = await import("@/app/api/extractions/[extractionId]/practice-sets/route");

function req() {
  return new Request("http://localhost/api/extractions/extraction_1/practice-sets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
function ctx() {
  return { params: Promise.resolve({ extractionId: "extraction_1" }) };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    id: "extraction_1",
    status: "CONFIRMED",
    upload: { studentProfileId: "sp_1", studentProfile: { status: "ACTIVE" } },
    problems: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dbMock.practiceSet.count.mockResolvedValue(0);
  dbMock.practiceSet.create.mockResolvedValue({
    id: "set_1",
    extractionId: "extraction_1",
    status: "GENERATING",
    failureCode: null,
    createdAt: new Date(),
    finishedAt: null,
  });
});

it("404s cross-account / nonexistent extraction", async () => {
  dalMock.requireExtraction.mockResolvedValue(null);
  const res = await POST(req(), ctx());
  expect(res.status).toBe(404);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
});

it("403s a non-ACTIVE profile, checked before the flow/rate-limit checks and before any write", async () => {
  dalMock.requireExtraction.mockResolvedValue(
    extraction({ upload: { studentProfileId: "sp_1", studentProfile: { status: "CONSENT_WITHDRAWN" } } }),
  );
  const res = await POST(req(), ctx());
  expect(res.status).toBe(403);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
  expect(runPracticeGenerationMock).not.toHaveBeenCalled();
});

it("M2 AC 3: 409s a non-CONFIRMED extraction, with ZERO PracticeSet rows and ZERO AI calls", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction({ status: "COMPLETE" }));
  const res = await POST(req(), ctx());
  expect(res.status).toBe(409);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
  expect(runPracticeGenerationMock).not.toHaveBeenCalled();
});

it("M2 AC 26: 429s above the hourly cap (5), with ZERO AI calls, and the count includes FAILED sets by construction (it counts all PracticeSet rows)", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction());
  dbMock.practiceSet.count.mockResolvedValue(5);
  const res = await POST(req(), ctx());
  expect(res.status).toBe(429);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
  expect(runPracticeGenerationMock).not.toHaveBeenCalled();
});

it("M2 AC 1: 202s, creates a GENERATING PracticeSet BEFORE scheduling generation, and the row IS the rate-limit grant", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction());
  const res = await POST(req(), ctx());
  const body = (await res.json()) as { data: { set: { id: string; status: string } } };

  expect(res.status).toBe(202);
  expect(body.data.set.status).toBe("GENERATING");
  expect(dbMock.practiceSet.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ studentProfileId: "sp_1", extractionId: "extraction_1", status: "GENERATING" }),
    }),
  );
  expect(afterMock).toHaveBeenCalledTimes(1);
});

it("rejects a non-empty body (the .strict() schema)", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction());
  const res = await POST(
    new Request("http://localhost/api/extractions/extraction_1/practice-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unexpected: "field" }),
    }),
    ctx(),
  );
  expect(res.status).toBe(400);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
});
