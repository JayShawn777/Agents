import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_IDLE_TIMEOUT_MS, CHAT_MESSAGES_PER_HOUR, CHAT_MESSAGE_MAX_LENGTH } from "@/lib/config";
import { DISTRESS_SAFETY_MESSAGE } from "@/lib/chat/prompt";
import type { ChatStreamEvent } from "@/lib/schemas/dto";

/**
 * `app/api/chat/sessions/[sessionId]/messages/route.ts` (endpoint 37).
 *
 * ADR-0013 §2 is what makes this file possible: every failure BEFORE the first
 * byte is still a normal `ApiResult` with a real status code, so all six of
 * M3's status-bearing criteria are asserted by calling the handler directly,
 * exactly as every other route's are. Only what happens after the stream opens
 * needs the NDJSON reader below.
 */

/**
 * A FAITHFUL `after()`: it collects callbacks and runs them only when the test
 * says the response has finished. The previous mock invoked the callback
 * immediately, which production never does — and that difference is exactly
 * what let a real bug through (see the registration test below).
 */
const afterCallbacks: (() => unknown)[] = [];
const afterMock = vi.fn((cb: () => unknown) => {
  afterCallbacks.push(cb);
});
vi.mock("next/server", () => ({ after: afterMock }));

/** Runs what `after()` scheduled, the way the platform does once a response ends. */
async function runAfterCallbacks(): Promise<void> {
  const pending = afterCallbacks.splice(0, afterCallbacks.length);
  for (const cb of pending) await cb();
}

const dalMock = {
  requireChatSession: vi.fn(),
  // Typed with the null arm the DAL actually has, so the 401 case below can
  // set it without a cast.
  verifySession: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  chatMessage: {
    aggregate: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  chatSession: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return arg;
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const streamFactory = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    getAnthropicClient: () => ({ messages: { stream: streamFactory } }),
  };
});

const { POST } = await import("@/app/api/chat/sessions/[sessionId]/messages/route");
const { Prisma } = await import("@/lib/generated/prisma/client");

// ─────────────────────────── fixtures ───────────────────────────

const TURN_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

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
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    studentProfile: { id: "sp_1", status: "ACTIVE" },
    extractedProblem: { id: "ep_1", text: "What is 1/4 + 1/4?" },
    attempt: null,
    messages: [],
    ...overrides,
  };
}

function chatMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_u",
    sessionId: "sess_1",
    role: "USER",
    content: "why?",
    sequence: 1,
    partial: false,
    truncated: false,
    safetyResponse: false,
    clientTurnId: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function req(body: unknown, init?: { signal?: AbortSignal }) {
  return new Request("http://localhost/api/chat/sessions/sess_1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
}
function ctx() {
  return { params: Promise.resolve({ sessionId: "sess_1" }) };
}
const validBody = { clientTurnId: TURN_ID, content: "why did you flip it?" };

/** A fake `client.messages.stream(...)`: async-iterable, abortable, with a final message. */
function fakeAnthropicStream(opts: {
  deltas?: string[];
  stopReason?: string;
  usage?: Record<string, number>;
  throws?: Error;
  hangAfterDeltas?: boolean;
}) {
  let rejectHang: ((err: Error) => void) | null = null;
  const state = { aborted: false };

  return {
    state,
    abort() {
      state.aborted = true;
      rejectHang?.(new Error("Request was aborted."));
    },
    async *[Symbol.asyncIterator]() {
      if (opts.throws) throw opts.throws;
      for (const text of opts.deltas ?? []) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text } };
      }
      if (opts.hangAfterDeltas) {
        await new Promise<never>((_, reject) => {
          rejectHang = reject;
        });
      }
    },
    async finalMessage() {
      return {
        stop_reason: opts.stopReason ?? "end_turn",
        stop_details: opts.stopReason === "refusal" ? { type: "refusal", category: "cyber" } : null,
        model: "claude-opus-5-internal-build-42",
        usage: {
          input_tokens: 1_742,
          output_tokens: 40,
          cache_read_input_tokens: 1_700,
          cache_creation_input_tokens: 0,
          ...opts.usage,
        },
      };
    },
  };
}

async function readEvents(res: Response): Promise<ChatStreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireChatSession.mockResolvedValue(chatSession());
  dbMock.chatMessage.count.mockResolvedValue(0);
  dbMock.chatMessage.aggregate.mockResolvedValue({ _max: { sequence: 0 } });
  dbMock.chatMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...chatMessage(),
    id: data.role === "USER" ? "msg_u" : "msg_a",
    createdAt: new Date(),
    ...data,
  }));
  dbMock.chatMessage.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    ...chatMessage({ id: where.id, role: "ASSISTANT", sequence: 2 }),
    ...data,
  }));
  dbMock.chatMessage.findMany.mockResolvedValue([
    chatMessage({ id: "msg_u", role: "USER", content: "why did you flip it?", sequence: 1, clientTurnId: TURN_ID }),
    chatMessage({ id: "msg_a", role: "ASSISTANT", content: "", sequence: 2, partial: true }),
  ]);
  dbMock.chatSession.update.mockResolvedValue({ studentTurnCount: 2 });
  dbMock.chatSession.updateMany.mockResolvedValue({ count: 1 });
  dbMock.chatSession.findUnique.mockResolvedValue({ studentTurnCount: 2 });
  streamFactory.mockImplementation(() => fakeAnthropicStream({ deltas: ["Where ", "are you stuck?"] }));
});

afterEach(() => {
  vi.useRealTimers();
});

// ────────────── before the first byte: the ApiResult envelope still holds ──────────────

describe("failures before the stream opens (ADR-0013 §2)", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    const res = await POST(req(validBody), ctx());
    expect(res.status).toBe(401);
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("404s a cross-account or unknown session, disclosing nothing (AC 15)", async () => {
    dalMock.requireChatSession.mockResolvedValue(null);
    const res = await POST(req(validBody), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe("We couldn't find that.");
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("403s a non-ACTIVE profile, before the body would even matter", async () => {
    dalMock.requireChatSession.mockResolvedValue(
      chatSession({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN" } }),
    );
    // A body that would ALSO fail validation: the 403 must win, or the response
    // tells an attacker the field shape was the problem and the profile is
    // otherwise writable (M0 AC 11's ordering).
    const res = await POST(req({ nonsense: true }), ctx());
    expect(res.status).toBe(403);
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("409s a session that is already closed", async () => {
    dalMock.requireChatSession.mockResolvedValue(chatSession({ status: "CLOSED_BY_STUDENT" }));
    const res = await POST(req(validBody), ctx());
    expect(res.status).toBe(409);
    expect(streamFactory).not.toHaveBeenCalled();
  });

  /**
   * AC 6, and the ordering ADR-0012 §1 asks for: a session past its bounds is
   * CLOSED — status, `closedAt`, and the templated wrap-up written as a stored
   * assistant message — and only then refused. Not refused and left open to be
   * refused again forever.
   */
  it("closes a session past its turn limit, writes the wrap-up, and then 409s", async () => {
    dalMock.requireChatSession.mockResolvedValue(chatSession({ studentTurnCount: 20, maxStudentTurns: 20 }));
    dbMock.chatMessage.aggregate.mockResolvedValue({ _max: { sequence: 40 } });

    const res = await POST(req(validBody), ctx());

    expect(res.status).toBe(409);
    expect(dbMock.chatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess_1", status: "OPEN" },
        data: expect.objectContaining({ status: "CLOSED_TURN_LIMIT" }),
      }),
    );
    const wrapUp = dbMock.chatMessage.create.mock.calls[0][0].data;
    expect(wrapUp.role).toBe("ASSISTANT");
    expect(wrapUp.sequence).toBe(41);
    expect(wrapUp.content).toContain("start a fresh session");
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("closes a session past its time limit and 409s", async () => {
    dalMock.requireChatSession.mockResolvedValue(chatSession({ expiresAt: new Date(Date.now() - 1_000) }));
    const res = await POST(req(validBody), ctx());
    expect(res.status).toBe(409);
    expect(dbMock.chatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED_TIME_LIMIT" }) }),
    );
  });

  // AC 10 — all three are the zod schema, so none of them can reach the model.
  it("400s an over-length message with no AI call", async () => {
    const res = await POST(req({ clientTurnId: TURN_ID, content: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }), ctx());
    expect(res.status).toBe(400);
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("400s a whitespace-only message, so a child leaning on the space bar spends no turn", async () => {
    const res = await POST(req({ clientTurnId: TURN_ID, content: "   " }), ctx());
    expect(res.status).toBe(400);
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("400s a missing or non-uuid clientTurnId", async () => {
    expect((await POST(req({ content: "hi" }), ctx())).status).toBe(400);
    expect((await POST(req({ clientTurnId: "not-a-uuid", content: "hi" }), ctx())).status).toBe(400);
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("400s an undeclared key rather than ignoring it (.strict())", async () => {
    const res = await POST(req({ ...validBody, studentName: "Ada" }), ctx());
    expect(res.status).toBe(400);
  });

  it("429s past the hourly message cap with no AI call (AC 20)", async () => {
    dbMock.chatMessage.count.mockResolvedValue(CHAT_MESSAGES_PER_HOUR);
    const res = await POST(req(validBody), ctx());
    expect(res.status).toBe(429);
    expect(streamFactory).not.toHaveBeenCalled();
  });

  it("counts the cap over the caller's own profile and student messages only", async () => {
    await POST(req(validBody), ctx());
    expect(dbMock.chatMessage.count).toHaveBeenCalledWith({
      where: {
        role: "USER",
        createdAt: { gte: expect.any(Date) },
        session: { studentProfileId: "sp_1" },
      },
    });
  });
});

// ────────────── after the stream opens ──────────────

describe("the NDJSON stream", () => {
  it("returns 200 with the streaming headers, not an ApiResult body", async () => {
    const res = await POST(req(validBody), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("emits exactly one turn, then deltas, then one done", async () => {
    const events = await readEvents(await POST(req(validBody), ctx()));
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "delta", "done"]);
  });

  it("emits the turn event BEFORE the AI call, carrying the assistant message id", async () => {
    const events = await readEvents(await POST(req(validBody), ctx()));
    const turn = events[0];
    expect(turn.type).toBe("turn");
    if (turn.type !== "turn") throw new Error("unreachable");
    expect(turn.assistantMessageId).toBe("msg_a");
    expect(turn.userMessage.content).toBe("why did you flip it?");
  });

  it("writes both rows before the model is called (AC 11)", async () => {
    await POST(req(validBody), ctx());
    const roles = dbMock.chatMessage.create.mock.calls.map((call) => call[0].data.role);
    expect(roles).toEqual(["USER", "ASSISTANT"]);

    const [userRow, assistantRow] = dbMock.chatMessage.create.mock.calls.map((call) => call[0].data);
    expect(userRow).toMatchObject({ clientTurnId: TURN_ID, sequence: 1 });
    // Empty and partial until the reply lands, and carrying NO clientTurnId —
    // Postgres treats NULLs as distinct, which is what lets many assistant rows
    // coexist under one unique index.
    expect(assistantRow).toMatchObject({ content: "", partial: true, sequence: 2 });
    expect(assistantRow.clientTurnId).toBeUndefined();
  });

  it("counts the student's turn exactly once", async () => {
    await POST(req(validBody), ctx());
    expect(dbMock.chatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { studentTurnCount: { increment: 1 } } }),
    );
  });

  it("persists the finished reply with its token counts and cache metrics (AC 11, ADR-0012 §4)", async () => {
    // The body must be consumed first: `POST` returns as soon as the Response
    // exists, and the reply is persisted when the stream finishes.
    await readEvents(await POST(req(validBody), ctx()));
    const final = dbMock.chatMessage.update.mock.calls.at(-1)?.[0];
    expect(final.where).toEqual({ id: "msg_a" });
    expect(final.data).toMatchObject({
      content: "Where are you stuck?",
      partial: false,
      truncated: false,
      inputTokens: 1_742,
      outputTokens: 40,
      cacheReadTokens: 1_700,
      cacheWriteTokens: 0,
    });
  });

  /**
   * The session row is read before the turn is counted, so the row in hand is
   * one behind. A client renders "turns left" off this and AC 6's bound is
   * counted in it — reporting it stale tells a child they have one more turn
   * than they really do.
   */
  it("reports the post-increment turn count on done", async () => {
    const events = await readEvents(await POST(req(validBody), ctx()));
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("unreachable");
    expect(done.session.studentTurnCount).toBe(2);
    expect(done.session.maxStudentTurns).toBe(20);
  });

  it("never puts token counts or the model id on the wire", async () => {
    const raw = await (await POST(req(validBody), ctx())).text();
    expect(raw).not.toContain("1742");
    expect(raw).not.toContain("claude-opus-5");
    expect(raw).not.toContain("cacheReadTokens");
  });
});

describe("truncation (AC 13)", () => {
  it("marks a reply that hit the output cap and still delivers it as done", async () => {
    streamFactory.mockImplementation(() =>
      fakeAnthropicStream({ deltas: ["The first step is"], stopReason: "max_tokens" }),
    );

    const events = await readEvents(await POST(req(validBody), ctx()));
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") throw new Error("unreachable");
    expect(done.message.truncated).toBe(true);
    // A truncation is a SUCCESS that stops mid-sentence, not a failure: the
    // text is real and the student keeps it.
    expect(done.message.partial).toBe(false);
    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].data).toMatchObject({ truncated: true, partial: false });
  });
});

describe("refusal and upstream failure (AC 18)", () => {
  it("turns a refusal into a terminal error event with an allowlisted message", async () => {
    streamFactory.mockImplementation(() => fakeAnthropicStream({ deltas: [], stopReason: "refusal" }));

    const events = await readEvents(await POST(req(validBody), ctx()));
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type !== "error") throw new Error("unreachable");
    expect(last.message).toBe("I can't help with that one. Try asking about the problem in a different way.");
  });

  it("leaks no stop_details category, model id or exception text to the browser", async () => {
    streamFactory.mockImplementation(() => fakeAnthropicStream({ deltas: [], stopReason: "refusal" }));
    const raw = await (await POST(req(validBody), ctx())).text();
    expect(raw).not.toContain("cyber");
    expect(raw).not.toContain("claude-opus-5-internal-build-42");
    expect(raw).not.toContain("stop_details");
  });

  it("turns a thrown SDK error into a terminal error event, never a stack trace", async () => {
    const boom = new Error("connect ECONNREFUSED 10.0.0.1:443 — api.anthropic.com");
    streamFactory.mockImplementation(() => fakeAnthropicStream({ throws: boom }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const raw = await (await POST(req(validBody), ctx())).text();
    expect(raw).not.toContain("ECONNREFUSED");
    expect(raw).not.toContain("10.0.0.1");

    const events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChatStreamEvent);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("persists what it had as partial when a turn fails", async () => {
    streamFactory.mockImplementation(() =>
      fakeAnthropicStream({ deltas: ["Let me think abo"], stopReason: "refusal" }),
    );
    await readEvents(await POST(req(validBody), ctx()));
    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      content: "Let me think abo",
      partial: true,
    });
  });
});

describe("the idle timeout (AC 19)", () => {
  /**
   * A stream that stalls between tokens. The timer resets on every forwarded
   * delta, so this measures the GAP rather than the length of the reply — a
   * long answer is not a stall.
   */
  it("aborts a stalled stream, persists the partial, and emits a terminal error", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeAnthropicStream({ deltas: ["Where "], hangAfterDeltas: true });
    streamFactory.mockImplementation(() => fake);

    const res = await POST(req(validBody), ctx());
    const bodyPromise = res.text();

    await vi.advanceTimersByTimeAsync(CHAT_IDLE_TIMEOUT_MS + 100);
    const raw = await bodyPromise;

    expect(fake.state.aborted).toBe(true);
    const events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChatStreamEvent);
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "error"]);
    const last = events.at(-1);
    if (last?.type !== "error") throw new Error("unreachable");
    expect(last.message).toBe("That took too long to come back. Please try asking again.");

    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      content: "Where ",
      partial: true,
    });
  });
});

describe("abort mid-stream (AC 12)", () => {
  it("cancels generation and persists the partial through after()", async () => {
    const controller = new AbortController();
    const fake = fakeAnthropicStream({ deltas: ["Where "], hangAfterDeltas: true });
    streamFactory.mockImplementation(() => fake);

    const res = await POST(req(validBody, { signal: controller.signal }), ctx());
    const bodyPromise = res.text();

    // Let the first delta be forwarded before the tab closes.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await bodyPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runAfterCallbacks();

    // Generation actually stopped, so a closed tab stops costing output tokens.
    expect(fake.state.aborted).toBe(true);
    expect(afterMock).toHaveBeenCalled();
    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      content: "Where ",
      partial: true,
    });
  });

  /**
   * THE REGRESSION THIS FILE EXISTS TO PREVENT, found in the M3 review.
   *
   * `after()` reads Next's request context out of `AsyncLocalStorage` and
   * THROWS when there is none. That context propagates through the stream's own
   * awaits but NOT into an `AbortSignal` listener — the listener runs in the
   * context of whoever called `abort()`. So calling `after()` from the abort
   * handler threw inside an event listener, nothing was persisted, and AC 12
   * quietly did not hold.
   *
   * The original test could not catch it, because it mocked `after` and then
   * asserted the mock was called — which proves nothing about whether the real
   * function would have worked. This asserts the property that actually
   * matters: `after` is registered EAGERLY, while the request context still
   * exists, not from inside the abort handler.
   */
  it("registers the after() callback before any abort, while the request context still exists", async () => {
    const controller = new AbortController();
    const fake = fakeAnthropicStream({ deltas: ["Where "], hangAfterDeltas: true });
    streamFactory.mockImplementation(() => fake);

    const res = await POST(req(validBody, { signal: controller.signal }), ctx());
    const bodyPromise = res.text();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Registered already — with nothing aborted yet and no partial to write.
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(dbMock.chatMessage.update).not.toHaveBeenCalled();

    controller.abort();
    await bodyPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // And the abort did NOT add a second registration — it only handed the
    // accumulated text to the callback that was already scheduled.
    expect(afterMock).toHaveBeenCalledTimes(1);

    await runAfterCallbacks();
    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      content: "Where ",
      partial: true,
    });
  });
});

describe("idempotency on clientTurnId (AC 12)", () => {
  function collideOnTurnId() {
    dbMock.chatMessage.create.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["sessionId", "clientTurnId"] },
      });
    });
  }

  /**
   * The ADR's own cost argument: a retry of a turn we already answered replays
   * the stored reply instead of regenerating it, so a flaky connection does not
   * double-bill. One turn, one generation, one pair of rows.
   */
  it("replays a completed turn without a second AI call", async () => {
    collideOnTurnId();
    dbMock.chatMessage.findFirst
      .mockResolvedValueOnce(chatMessage({ id: "msg_u", role: "USER", sequence: 1, clientTurnId: TURN_ID }))
      .mockResolvedValueOnce(
        chatMessage({ id: "msg_a", role: "ASSISTANT", content: "Where are you stuck?", sequence: 2, partial: false }),
      );

    const events = await readEvents(await POST(req(validBody), ctx()));

    expect(streamFactory).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "done"]);
    const delta = events[1];
    if (delta.type !== "delta") throw new Error("unreachable");
    expect(delta.text).toBe("Where are you stuck?");
  });

  it("does not count a replayed turn against the session's turn limit", async () => {
    collideOnTurnId();
    dbMock.chatMessage.findFirst
      .mockResolvedValueOnce(chatMessage({ id: "msg_u", role: "USER", sequence: 1, clientTurnId: TURN_ID }))
      .mockResolvedValueOnce(chatMessage({ id: "msg_a", role: "ASSISTANT", content: "done", sequence: 2 }));

    await POST(req(validBody), ctx());
    expect(dbMock.chatSession.update).not.toHaveBeenCalled();
  });

  /**
   * Two requests carrying one `clientTurnId` arriving together. The loser must
   * NOT start a second generation into the row the winner is still streaming —
   * a fresh partial is presumed in flight, not abandoned.
   */
  it("treats a fresh partial as in-flight and does not generate a second time", async () => {
    collideOnTurnId();
    dbMock.chatMessage.findFirst
      .mockResolvedValueOnce(chatMessage({ id: "msg_u", role: "USER", sequence: 1, clientTurnId: TURN_ID }))
      .mockResolvedValueOnce(
        chatMessage({ id: "msg_a", role: "ASSISTANT", content: "Wher", sequence: 2, partial: true, createdAt: new Date() }),
      );

    const events = await readEvents(await POST(req(validBody), ctx()));
    expect(streamFactory).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "done"]);
  });

  /**
   * A partial older than the idle budget means the function generating it is
   * gone. The turn is regenerated INTO THE SAME ROW — still one user row, one
   * assistant row, one turn. It is regenerated rather than continued because
   * assistant prefill returns a 400 on Opus 5, so there is no supported way to
   * resume a truncated reply.
   */
  it("regenerates into the same row when the partial is stale, creating no new rows", async () => {
    collideOnTurnId();
    dbMock.chatMessage.findFirst
      .mockResolvedValueOnce(chatMessage({ id: "msg_u", role: "USER", sequence: 1, clientTurnId: TURN_ID }))
      .mockResolvedValueOnce(
        chatMessage({
          id: "msg_a",
          role: "ASSISTANT",
          content: "Wher",
          sequence: 2,
          partial: true,
          createdAt: new Date(Date.now() - CHAT_IDLE_TIMEOUT_MS - 60_000),
        }),
      );

    const events = await readEvents(await POST(req(validBody), ctx()));

    expect(streamFactory).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "delta", "done"]);
    // The USER row create was attempted and collided; no SECOND pair was made.
    expect(dbMock.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].where).toEqual({ id: "msg_a" });
    // And the retry does not spend one of the child's twenty turns.
    expect(dbMock.chatSession.update).not.toHaveBeenCalled();
  });

  /**
   * The other P2002 on this table is `@@unique([sessionId, sequence])` — two
   * DIFFERENT turns racing for one sequence number. Same error code, opposite
   * situation: recount and go, never a replay.
   */
  it("retries a lost sequence race instead of mistaking it for a retried turn", async () => {
    dbMock.chatMessage.create.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["sessionId", "sequence"] },
      });
    });

    const events = await readEvents(await POST(req(validBody), ctx()));
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "delta", "done"]);
    expect(dbMock.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(streamFactory).toHaveBeenCalledTimes(1);
  });
});

// ────────────── AC 21 ──────────────

describe("distress (AC 21)", () => {
  const distressBody = { clientTurnId: TURN_ID, content: "i want to die" };

  /**
   * The plan's own acceptance row: "Distress fixtures → the fixed message,
   * `safetyResponse: true`, no AI call, no advice."
   */
  it("answers with the fixed message and makes NO AI call", async () => {
    const events = await readEvents(await POST(req(distressBody), ctx()));

    expect(streamFactory).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["turn", "delta", "done"]);
    const delta = events[1];
    if (delta.type !== "delta") throw new Error("unreachable");
    expect(delta.text).toBe(DISTRESS_SAFETY_MESSAGE);
  });

  it("marks the stored reply as a safety response, not model output", async () => {
    await readEvents(await POST(req(distressBody), ctx()));
    expect(dbMock.chatMessage.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      content: DISTRESS_SAFETY_MESSAGE,
      safetyResponse: true,
      partial: false,
    });
  });

  /**
   * The turn's rows are still written. A parent reading the transcript (AC 14)
   * must be able to see what their child said and what we replied — a distress
   * turn that vanished from the record would be the worst possible gap in it.
   */
  it("still persists the student's own message", async () => {
    await readEvents(await POST(req(distressBody), ctx()));
    const userRow = dbMock.chatMessage.create.mock.calls[0][0].data;
    expect(userRow).toMatchObject({ role: "USER", content: "i want to die" });
  });

  it("offers no advice, diagnosis or counselling of its own", async () => {
    const raw = await (await POST(req(distressBody), ctx())).text();
    // The ONLY assistant text on the wire is the fixed copy somebody chose.
    const deltas = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChatStreamEvent)
      .filter((e): e is Extract<ChatStreamEvent, { type: "delta" }> => e.type === "delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].text).toBe(DISTRESS_SAFETY_MESSAGE);
  });

  it("tutors normally when the message is ordinary", async () => {
    await readEvents(await POST(req(validBody), ctx()));
    expect(streamFactory).toHaveBeenCalledTimes(1);
  });
});
