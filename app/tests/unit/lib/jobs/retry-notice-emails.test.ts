import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SendEmailResult } from "@/lib/email/client";
import type { SendDirectNoticeEmailInput } from "@/lib/email/send-direct-notice";

/**
 * `lib/jobs/retry-notice-emails.ts` (B22, endpoint 28, M0 AC 14).
 *
 * No window/boundary here — the job's only predicate is `sentAt IS NULL`,
 * not an age comparison — so this suite proves: only rows with a null
 * `sentAt` are retried, a delivered retry stamps `sentAt`/`emailDeliveryRef`,
 * and an undelivered retry stamps nothing (so the NEXT run retries it again).
 */

const dbMock = {
  directNotice: {
    findMany: vi.fn(async () => [] as Array<{ id: string; noticeVersion: string; user: { email: string } }>),
    update: vi.fn(),
  },
};

const emailMock = {
  sendDirectNoticeEmail: vi.fn<(input: SendDirectNoticeEmailInput) => Promise<SendEmailResult>>(async () => ({
    delivered: true,
    deliveryRef: "resend_1",
  })),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/email/send-direct-notice", () => emailMock);

const { retryNoticeEmails } = await import("@/lib/jobs/retry-notice-emails");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const clock = () => NOW;
const fakeStorage = {} as never; // never touched — see the job's own docstring

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.directNotice.findMany.mockResolvedValue([]);
  emailMock.sendDirectNoticeEmail.mockResolvedValue({ delivered: true, deliveryRef: "resend_1" });
});

describe("retryNoticeEmails — selection query", () => {
  it("selects only DirectNotice rows with sentAt IS NULL", async () => {
    await retryNoticeEmails(fakeStorage, clock);

    expect(dbMock.directNotice.findMany).toHaveBeenCalledWith({
      where: { sentAt: null },
      include: { user: { select: { email: true } } },
    });
  });
});

describe("retryNoticeEmails — delivery outcomes", () => {
  it("stamps sentAt/emailDeliveryRef on a successfully delivered retry", async () => {
    dbMock.directNotice.findMany.mockResolvedValue([
      { id: "notice_1", noticeVersion: "2026-08-26.1", user: { email: "parent@example.com" } },
    ]);
    emailMock.sendDirectNoticeEmail.mockResolvedValue({ delivered: true, deliveryRef: "resend_abc" });

    const result = await retryNoticeEmails(fakeStorage, clock);

    expect(emailMock.sendDirectNoticeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "parent@example.com", noticeVersion: "2026-08-26.1" }),
    );
    expect(dbMock.directNotice.update).toHaveBeenCalledWith({
      where: { id: "notice_1" },
      data: { sentAt: NOW, emailDeliveryRef: "resend_abc" },
    });
    expect(result).toEqual({ retried: 1, sent: 1 });
  });

  it("stamps nothing when the retry is not delivered, so the row is retried again next run", async () => {
    dbMock.directNotice.findMany.mockResolvedValue([
      { id: "notice_1", noticeVersion: "2026-08-26.1", user: { email: "parent@example.com" } },
    ]);
    emailMock.sendDirectNoticeEmail.mockResolvedValue({ delivered: false, deliveryRef: null });

    const result = await retryNoticeEmails(fakeStorage, clock);

    expect(dbMock.directNotice.update).not.toHaveBeenCalled();
    expect(result).toEqual({ retried: 1, sent: 0 });
  });

  it("processes multiple pending notices independently", async () => {
    dbMock.directNotice.findMany.mockResolvedValue([
      { id: "notice_1", noticeVersion: "2026-08-26.1", user: { email: "a@example.com" } },
      { id: "notice_2", noticeVersion: "2026-08-26.1", user: { email: "b@example.com" } },
    ]);
    emailMock.sendDirectNoticeEmail
      .mockResolvedValueOnce({ delivered: true, deliveryRef: "ref_1" })
      .mockResolvedValueOnce({ delivered: false, deliveryRef: null });

    const result = await retryNoticeEmails(fakeStorage, clock);

    expect(result).toEqual({ retried: 2, sent: 1 });
  });

  it("reports retried: 0, sent: 0 when nothing is pending", async () => {
    const result = await retryNoticeEmails(fakeStorage, clock);
    expect(result).toEqual({ retried: 0, sent: 0 });
    expect(emailMock.sendDirectNoticeEmail).not.toHaveBeenCalled();
  });
});
