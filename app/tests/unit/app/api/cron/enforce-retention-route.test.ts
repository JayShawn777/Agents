import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/cron/enforce-retention` (endpoint 27, B23). See
 * `reconcile-blobs-route.test.ts` for what this suite covers and why; the
 * job's own behaviour is `tests/unit/lib/jobs/enforce-retention.test.ts`.
 */

const jobMock = {
  enforceRetention: vi.fn(async () => ({ byCategory: {} })),
};

vi.mock("@/lib/jobs/enforce-retention", () => jobMock);

const { GET } = await import("@/app/api/cron/enforce-retention/route");

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/enforce-retention", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe("GET /api/cron/enforce-retention — auth gate", () => {
  it("401s and never runs the job with no Authorization header", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(jobMock.enforceRetention).not.toHaveBeenCalled();
  });

  it("401s and never runs the job with a wrong bearer token", async () => {
    const res = await GET(req({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(jobMock.enforceRetention).not.toHaveBeenCalled();
  });

  it("runs the job and returns its result with a matching bearer token", async () => {
    jobMock.enforceRetention.mockResolvedValueOnce({ byCategory: { SOURCE_FILE: 1 } });
    const res = await GET(req({ authorization: "Bearer test-cron-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(jobMock.enforceRetention).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ ok: true, data: { byCategory: { SOURCE_FILE: 1 } } });
  });

  it("maps a job rejection to 502 UPSTREAM_ERROR", async () => {
    jobMock.enforceRetention.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(req({ authorization: "Bearer test-cron-secret" }));
    expect(res.status).toBe(502);
  });
});
