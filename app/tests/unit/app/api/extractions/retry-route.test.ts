import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/extractions/[extractionId]/retry/route.ts` (endpoint 20). */

const dalMock = { requireExtraction: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: afterMock }));

const dbMock = { extraction: { update: vi.fn() } };
vi.mock("@/lib/db", () => ({ db: dbMock }));

const runExtractionMock = vi.fn(async () => ({ status: "SKIPPED" as const }));
vi.mock("@/lib/extraction/run-extraction", () => ({ runExtraction: runExtractionMock }));

const { POST } = await import("@/app/api/extractions/[extractionId]/retry/route");

function req() {
  return new Request("http://localhost/api/extractions/extraction_1/retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
function ctx() {
  return { params: Promise.resolve({ extractionId: "extraction_1" }) };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return { id: "extraction_1", status: "FAILED", attemptCount: 1, problems: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dbMock.extraction.update.mockResolvedValue(extraction({ status: "PENDING" }));
});

it("404s cross-account", async () => {
  dalMock.requireExtraction.mockResolvedValue(null);
  const res = await POST(req(), ctx());
  expect(res.status).toBe(404);
});

it("409s a retry against a non-FAILED extraction", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction({ status: "COMPLETE" }));
  const res = await POST(req(), ctx());
  expect(res.status).toBe(409);
  expect(dbMock.extraction.update).not.toHaveBeenCalled();
});

it("429s above MAX_EXTRACTION_ATTEMPTS (3) even though status is FAILED", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction({ status: "FAILED", attemptCount: 3 }));
  const res = await POST(req(), ctx());
  expect(res.status).toBe(429);
  expect(dbMock.extraction.update).not.toHaveBeenCalled();
});

it("202s, flips to PENDING, and reschedules the run for an eligible retry", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction({ status: "FAILED", attemptCount: 1 }));

  const res = await POST(req(), ctx());
  const body = (await res.json()) as { data: { extraction: { status: string } } };

  expect(res.status).toBe(202);
  expect(body.data.extraction.status).toBe("PENDING");
  expect(dbMock.extraction.update).toHaveBeenCalledWith({ where: { id: "extraction_1" }, data: { status: "PENDING" } });
  expect(afterMock).toHaveBeenCalledTimes(1);
});
