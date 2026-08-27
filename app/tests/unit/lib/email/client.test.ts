import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("sendEmail() console transport", () => {
  const originalTransport = process.env.EMAIL_TRANSPORT;
  const originalFetch = global.fetch;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.EMAIL_TRANSPORT = originalTransport;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reports delivered: false for the console transport — a caller must never treat this as real delivery (AC 14)", async () => {
    process.env.EMAIL_TRANSPORT = "console";
    const { sendEmail } = await import("@/lib/email/client");

    const result = await sendEmail({
      to: "parent@example.com",
      subject: "Notice about your child's information",
      text: "full body containing a live token URL",
      html: "<p>full body containing a live token URL</p>",
    });

    expect(result.delivered).toBe(false);
    expect(result.deliveryRef).toMatch(/^console:/);
  });

  it("logs only the recipient and subject — never the message body (which may carry a live magic-link/consent token)", async () => {
    process.env.EMAIL_TRANSPORT = "console";
    const { sendEmail } = await import("@/lib/email/client");

    const secretToken = "https://app.example.com/verify?token=super-secret-token-value";
    await sendEmail({
      to: "parent@example.com",
      subject: "Confirm you consent",
      text: `Open this link: ${secretToken}`,
      html: `<p>Open this link: <a href="${secretToken}">here</a></p>`,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(loggedLine).toContain("parent@example.com");
    expect(loggedLine).toContain("Confirm you consent");
    expect(loggedLine).not.toContain(secretToken);
    expect(loggedLine).not.toContain("super-secret-token-value");
  });

  it("does NOT use the console transport just because NODE_ENV isn't production — the gate is explicit", async () => {
    process.env.EMAIL_TRANSPORT = "anything-else";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { sendEmail } = await import("@/lib/email/client");
    await sendEmail({
      to: "parent@example.com",
      subject: "Notice about your child's information",
      text: "body",
      html: "<p>body</p>",
    });

    // Without a real AUTH_RESEND_KEY/EMAIL_FROM this fails before fetch is
    // ever called (caught by the `!apiKey || !from` guard) — the point of
    // this test is that it did NOT take the console-log branch, which
    // would never reach fetch at all either way. Assert indirectly: no
    // console.log call was made in this branch.
    expect(logSpy).not.toHaveBeenCalled();
  });
});
