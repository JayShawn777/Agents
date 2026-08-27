import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = {
  directNotice: {
    create: vi.fn(),
    update: vi.fn(),
  },
};

const sendDirectNoticeEmailMock = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/email/send-direct-notice", () => ({
  sendDirectNoticeEmail: sendDirectNoticeEmailMock,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent" }),
}));

const { submitNotice } = await import("@/lib/notice/service");
const { DIRECT_NOTICE_VERSION } = await import("@/lib/notice/copy");

const STUDENT = { id: "sp_1" };
const USER = { id: "user_1", email: "parent@example.com" };

const BASE_NOTICE_ROW = {
  id: "notice_1",
  studentProfileId: "sp_1",
  userId: "user_1",
  noticeVersion: DIRECT_NOTICE_VERSION,
  presentedAt: new Date("2026-01-01T00:00:00.000Z"),
  sentAt: null,
  emailDeliveryRef: null,
  ipAddress: "203.0.113.9",
  userAgent: "test-agent",
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.directNotice.create.mockResolvedValue({ ...BASE_NOTICE_ROW });
});

describe("submitNotice (endpoint 7)", () => {
  it("rejects a stale noticeVersion without writing anything (AC 14)", async () => {
    const result = await submitNotice({ student: STUDENT, user: USER, noticeVersion: "1999-01-01.1" });
    expect(result).toEqual({ ok: false, code: "STALE_VERSION" });
    expect(dbMock.directNotice.create).not.toHaveBeenCalled();
  });

  it("writes the DirectNotice row with server-side IP/user-agent, never from a body field", async () => {
    sendDirectNoticeEmailMock.mockResolvedValue({ delivered: true, deliveryRef: "resend_123" });
    dbMock.directNotice.update.mockResolvedValue({ ...BASE_NOTICE_ROW, sentAt: new Date(), emailDeliveryRef: "resend_123" });

    await submitNotice({ student: STUDENT, user: USER, noticeVersion: DIRECT_NOTICE_VERSION });

    expect(dbMock.directNotice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentProfileId: "sp_1",
        userId: "user_1",
        noticeVersion: DIRECT_NOTICE_VERSION,
        ipAddress: "203.0.113.9",
        userAgent: "test-agent",
      }),
    });
  });

  it("stamps sentAt only when the transport reports delivered: true", async () => {
    sendDirectNoticeEmailMock.mockResolvedValue({ delivered: true, deliveryRef: "resend_123" });
    dbMock.directNotice.update.mockResolvedValue({
      ...BASE_NOTICE_ROW,
      sentAt: new Date("2026-01-01T00:01:00.000Z"),
      emailDeliveryRef: "resend_123",
    });

    const result = await submitNotice({ student: STUDENT, user: USER, noticeVersion: DIRECT_NOTICE_VERSION });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notice.sentAt).not.toBeNull();
    }
    expect(dbMock.directNotice.update).toHaveBeenCalledWith({
      where: { id: "notice_1" },
      data: expect.objectContaining({ emailDeliveryRef: "resend_123" }),
    });
  });

  it("never stamps sentAt off a console-transport (delivered: false) result — the row is still written with sentAt null", async () => {
    sendDirectNoticeEmailMock.mockResolvedValue({ delivered: false, deliveryRef: "console:123" });

    const result = await submitNotice({ student: STUDENT, user: USER, noticeVersion: DIRECT_NOTICE_VERSION });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notice.sentAt).toBeNull();
    }
    expect(dbMock.directNotice.update).not.toHaveBeenCalled();
  });

  it("repeat calls append another row rather than erroring or upserting", async () => {
    sendDirectNoticeEmailMock.mockResolvedValue({ delivered: false, deliveryRef: null });

    await submitNotice({ student: STUDENT, user: USER, noticeVersion: DIRECT_NOTICE_VERSION });
    await submitNotice({ student: STUDENT, user: USER, noticeVersion: DIRECT_NOTICE_VERSION });

    expect(dbMock.directNotice.create).toHaveBeenCalledTimes(2);
  });
});
