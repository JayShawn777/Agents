import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_WRAP_UP_MESSAGES } from "@/lib/chat/prompt";

/**
 * `app/api/chat/sessions/[sessionId]/route.ts` (endpoint 38) and
 * `.../close/route.ts` (endpoint 39).
 */

const dalMock = {
  requireChatSession: vi.fn(),
  verifySession: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  chatSession: { updateMany: vi.fn() },
  chatMessage: { aggregate: vi.fn(), create: vi.fn(), findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { GET } = await import("@/app/api/chat/sessions/[sessionId]/route");
const { POST: CLOSE } = await import("@/app/api/chat/sessions/[sessionId]/close/route");

// ─────────────────────────── fixtures ───────────────────────────

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    sessionId: "sess_1",
    role: "ASSISTANT",
    content: "Let's take a look at this one together.",
    sequence: 1,
    partial: false,
    truncated: false,
    safetyResponse: false,
    clientTurnId: null,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 1_700,
    cacheWriteTokens: 0,
    createdAt: new Date("2026-08-28T10:00:00Z"),
    ...overrides,
  };
}

function chatSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess_1",
    studentProfileId: "sp_1",
    extractedProblemId: "ep_1",
    attemptId: null,
    status: "OPEN",
    studentTurnCount: 1,
    maxStudentTurns: 20,
    revealAfterTurns: 3,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    renderedContext: "Learner context (m3.1).\n",
    contextHash: "hash",
    contextVersion: "m3.1",
    learnerProfileVersion: null,
    systemPromptVersion: "m3.1",
    model: "claude-opus-5",
    openedAt: new Date("2026-08-28T10:00:00Z"),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    studentProfile: { id: "sp_1", status: "ACTIVE" },
    extractedProblem: { id: "ep_1", text: "What is 1/4 + 1/4?" },
    attempt: null,
    messages: [message()],
    ...overrides,
  };
}

const getReq = () => new Request("http://localhost/api/chat/sessions/sess_1");
const closeReq = (body: unknown = {}) =>
  new Request("http://localhost/api/chat/sessions/sess_1/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = () => ({ params: Promise.resolve({ sessionId: "sess_1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireChatSession.mockResolvedValue(chatSession());
  dbMock.chatSession.updateMany.mockResolvedValue({ count: 1 });
  dbMock.chatMessage.aggregate.mockResolvedValue({ _max: { sequence: 1 } });
  dbMock.chatMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => message(data));
  dbMock.chatMessage.findMany.mockResolvedValue([message(), message({ id: "msg_wrap", sequence: 2 })]);
});

// ─────────────────────────── endpoint 38 ───────────────────────────

describe("reading a session (endpoint 38)", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await GET(getReq(), ctx())).status).toBe(401);
  });

  it("404s a cross-account or unknown session (AC 15)", async () => {
    dalMock.requireChatSession.mockResolvedValue(null);
    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("We couldn't find that.");
  });

  it("200s with the session and its full transcript in order (AC 14)", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({
        messages: [
          message({ id: "m1", sequence: 1 }),
          message({ id: "m2", role: "USER", content: "why?", sequence: 2 }),
          message({ id: "m3", content: "Because...", sequence: 3 }),
        ],
      }),
    );
    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.messages.map((m: { id: string }) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  /**
   * A parent who has just withdrawn consent must still be able to read what the
   * tutor said to their child — that is exactly when they are most likely to
   * want to. Auth here is Owner, not Owner+ACTIVE, on purpose.
   */
  it("serves a transcript for a profile whose consent was withdrawn", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN" } }),
    );
    expect((await GET(getReq(), ctx())).status).toBe(200);
  });

  /**
   * Found in the M3 review. The lazy close WRITES — a status transition and a
   * templated wrap-up message — and this is a read path a parent reaches AFTER
   * withdrawing consent. Writing a new row against a withdrawn profile is new
   * data about a child we have been told to stop processing, and the retention
   * job is already coming for those rows anyway.
   */
  it("does not write a wrap-up for a withdrawn profile, even when the session is past its bounds", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({
        studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN" },
        expiresAt: new Date(Date.now() - 1_000),
      }),
    );

    const res = await GET(getReq(), ctx());

    expect(res.status).toBe(200);
    expect(dbMock.chatSession.updateMany).not.toHaveBeenCalled();
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("never leaks the rendered context, the hash, the model or token counts", async () => {
    const raw = await (await GET(getReq(), ctx())).text();
    expect(raw).not.toContain("Learner context");
    expect(raw).not.toContain("claude-opus-5");
    expect(raw).not.toContain("cacheReadTokens");
    expect(raw).not.toContain("1700");
  });

  it("leaves an in-bounds session open and does not re-read the transcript", async () => {
    const res = await GET(getReq(), ctx());
    expect((await res.json()).data.session.status).toBe("OPEN");
    expect(dbMock.chatSession.updateMany).not.toHaveBeenCalled();
    expect(dbMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  /**
   * AC 6's lazy half — the same `reapIfStale` shape extraction uses, and the
   * reason M3 needs no cron job to close abandoned sessions.
   */
  it("lazily closes a session past its time limit and returns the wrap-up with it", async () => {
    dalMock.requireChatSession.mockResolvedValue(chatSession({ expiresAt: new Date(Date.now() - 1_000) }));
    dbMock.chatMessage.findMany.mockResolvedValue([
      message(),
      message({ id: "msg_wrap", sequence: 2, content: CHAT_WRAP_UP_MESSAGES.CLOSED_TIME_LIMIT }),
    ]);

    const res = await GET(getReq(), ctx());
    const body = await res.json();

    expect(body.data.session.status).toBe("CLOSED_TIME_LIMIT");
    expect(dbMock.chatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sess_1", status: "OPEN" } }),
    );
    // The wrap-up was written AFTER the resource snapshot, so serving that
    // snapshot would return a closed session whose closing message is missing.
    expect(dbMock.chatMessage.findMany).toHaveBeenCalled();
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[1].content).toBe(CHAT_WRAP_UP_MESSAGES.CLOSED_TIME_LIMIT);
  });

  it("lazily closes a session that used up its turns", async () => {
    dalMock.requireChatSession.mockResolvedValue(chatSession({ studentTurnCount: 20, maxStudentTurns: 20 }));
    const body = await (await GET(getReq(), ctx())).json();
    expect(body.data.session.status).toBe("CLOSED_TURN_LIMIT");
  });

  it("does not re-close an already closed session or append a second wrap-up", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({ status: "CLOSED_BY_STUDENT", closedAt: new Date(), expiresAt: new Date(Date.now() - 1_000) }),
    );
    const body = await (await GET(getReq(), ctx())).json();
    expect(body.data.session.status).toBe("CLOSED_BY_STUDENT");
    expect(dbMock.chatSession.updateMany).not.toHaveBeenCalled();
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
  });

  /** AC 19's retryable stub: partial, with empty content, and no extra DTO field to say so. */
  it("surfaces an abandoned turn as a partial message with empty content", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({
        messages: [message({ id: "m1", role: "USER", content: "why?", sequence: 1 }), message({ id: "m2", content: "", partial: true, sequence: 2 })],
      }),
    );
    const body = await (await GET(getReq(), ctx())).json();
    expect(body.data.messages[1]).toMatchObject({ partial: true, content: "", contentHtml: null });
  });
});

// ─────────────────────────── endpoint 39 ───────────────────────────

describe("closing a session (endpoint 39)", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await CLOSE(closeReq(), ctx())).status).toBe(401);
  });

  it("404s a cross-account or unknown session", async () => {
    dalMock.requireChatSession.mockResolvedValue(null);
    expect((await CLOSE(closeReq(), ctx())).status).toBe(404);
  });

  it("403s a non-ACTIVE profile", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN" } }),
    );
    expect((await CLOSE(closeReq(), ctx())).status).toBe(403);
    expect(dbMock.chatSession.updateMany).not.toHaveBeenCalled();
  });

  it("400s an undeclared body key", async () => {
    expect((await CLOSE(closeReq({ reason: "bored" }), ctx())).status).toBe(400);
  });

  it("200s, marks the session CLOSED_BY_STUDENT and appends the wrap-up (AC 6)", async () => {
    dbMock.chatMessage.findMany.mockResolvedValue([
      message(),
      message({ id: "msg_wrap", sequence: 2, content: CHAT_WRAP_UP_MESSAGES.CLOSED_BY_STUDENT }),
    ]);

    const res = await CLOSE(closeReq(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.session.status).toBe("CLOSED_BY_STUDENT");
    expect(body.data.session.closedAt).not.toBeNull();
    expect(dbMock.chatMessage.create.mock.calls[0][0].data).toMatchObject({
      role: "ASSISTANT",
      sequence: 2,
      content: CHAT_WRAP_UP_MESSAGES.CLOSED_BY_STUDENT,
    });
    expect(body.data.messages[1].content).toBe(CHAT_WRAP_UP_MESSAGES.CLOSED_BY_STUDENT);
  });

  /**
   * A double-click, a retried request or a flaky connection must not be an
   * error: the student asked for this session to be closed, and it is closed.
   */
  it("is idempotent for a session the student already closed, writing nothing", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({ status: "CLOSED_BY_STUDENT", closedAt: new Date("2026-08-28T10:05:00Z") }),
    );

    const res = await CLOSE(closeReq(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.session.status).toBe("CLOSED_BY_STUDENT");
    expect(dbMock.chatSession.updateMany).not.toHaveBeenCalled();
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
  });

  /**
   * The session ended for a reason the student did not choose, and it carries a
   * different wrap-up than this endpoint would show. A 409 sends the client to
   * GET to find out what actually happened, rather than reporting the wrong
   * ending.
   */
  it("409s a session already closed by a bound, rather than restating the ending", async () => {
    for (const status of ["CLOSED_TURN_LIMIT", "CLOSED_TIME_LIMIT"]) {
      vi.clearAllMocks();
      dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
      dalMock.requireChatSession.mockResolvedValue(chatSession({ status, closedAt: new Date() }));

      const res = await CLOSE(closeReq(), ctx());
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toContain("already finished on its own");
      expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
    }
  });

  it("guards the close on status OPEN so two racing requests write one wrap-up", async () => {
    await CLOSE(closeReq(), ctx());
    expect(dbMock.chatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess_1", status: "OPEN" },
        data: expect.objectContaining({ status: "CLOSED_BY_STUDENT" }),
      }),
    );
  });

  it("writes no wrap-up when it loses that race", async () => {
    dbMock.chatSession.updateMany.mockResolvedValue({ count: 0 });
    await CLOSE(closeReq(), ctx());
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
  });
});
