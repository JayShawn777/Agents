import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/cron/reconcile-blobs` (endpoint 24, B23). Only this route's own
 * concern: the `Bearer CRON_SECRET` gate runs BEFORE the job, and an
 * unauthenticated request never invokes `reconcileBlobs` at all. The job's
 * own behaviour is `tests/unit/lib/jobs/reconcile-blobs.test.ts`.
 */

const jobMock = {
  reconcileBlobs: vi.fn(async () => ({ scanned: 1, orphansDeleted: 0, uploadsFailed: 0, grantsPruned: 0 })),
};

vi.mock("@/lib/jobs/reconcile-blobs", () => jobMock);

const { GET } = await import("@/app/api/cron/reconcile-blobs/route");

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/reconcile-blobs", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe("GET /api/cron/reconcile-blobs — auth gate", () => {
  it("401s and never runs the job when no Authorization header is sent", async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ ok: false, error: { code: "UNAUTHENTICATED", message: expect.any(String) } });
    expect(jobMock.reconcileBlobs).not.toHaveBeenCalled();
  });

  it("401s and never runs the job when the bearer token is wrong", async () => {
    const res = await GET(req({ authorization: "Bearer wrong-secret" }));

    expect(res.status).toBe(401);
    expect(jobMock.reconcileBlobs).not.toHaveBeenCalled();
  });

  it("401s when CRON_SECRET is unset server-side, even with a matching-looking header", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: "Bearer undefined" }));

    expect(res.status).toBe(401);
    expect(jobMock.reconcileBlobs).not.toHaveBeenCalled();
  });

  it("runs the job and returns its result when the bearer token matches", async () => {
    const res = await GET(req({ authorization: "Bearer test-cron-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(jobMock.reconcileBlobs).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      ok: true,
      data: { scanned: 1, orphansDeleted: 0, uploadsFailed: 0, grantsPruned: 0 },
    });
  });

  it("maps a job rejection to 502 UPSTREAM_ERROR, never a raw exception", async () => {
    jobMock.reconcileBlobs.mockRejectedValueOnce(new Error("storage outage"));
    const res = await GET(req({ authorization: "Bearer test-cron-secret" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(JSON.stringify(body)).not.toContain("storage outage");
  });
});
