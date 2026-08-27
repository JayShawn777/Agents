import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/extractions/[extractionId]/confirm/route.ts` (endpoint 21, M1 AC 30). */

const dalMock = { requireExtraction: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  extraction: { update: vi.fn() },
  upload: { updateMany: vi.fn(async () => ({ count: 1 })) },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST } = await import("@/app/api/extractions/[extractionId]/confirm/route");

function req() {
  return new Request("http://localhost/api/extractions/extraction_1/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
}
function ctx() {
  return { params: Promise.resolve({ extractionId: "extraction_1" }) };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return { id: "extraction_1", status: "COMPLETE", upload: { id: "upload_1" }, problems: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dbMock.extraction.update.mockResolvedValue(extraction({ status: "CONFIRMED" }));
});

it("404s cross-account", async () => {
  dalMock.requireExtraction.mockResolvedValue(null);
  const res = await POST(req(), ctx());
  expect(res.status).toBe(404);
});

it("409s unless status is exactly COMPLETE — COMPLETE_EMPTY has nothing to confirm", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction({ status: "COMPLETE_EMPTY" }));
  const res = await POST(req(), ctx());
  expect(res.status).toBe(409);
  expect(dbMock.extraction.update).not.toHaveBeenCalled();
});

it("confirms and defensively re-stamps extractedAt if it wasn't already set", async () => {
  dalMock.requireExtraction.mockResolvedValue(extraction());

  const res = await POST(req(), ctx());
  const body = (await res.json()) as { data: { extraction: { status: string } } };

  expect(res.status).toBe(200);
  expect(body.data.extraction.status).toBe("CONFIRMED");
  expect(dbMock.upload.updateMany).toHaveBeenCalledWith({
    where: { id: "upload_1", extractedAt: null },
    data: { extractedAt: expect.any(Date) },
  });
});
