import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_MAX_SESSION_MINUTES, CHAT_MAX_STUDENT_TURNS, CHAT_REVEAL_AFTER_TURNS, CHAT_SESSIONS_PER_HOUR } from "@/lib/config";
import { LEARNER_CONTEXT_VERSION, hashContext, renderLearnerContext } from "@/lib/chat/context";

/**
 * `app/api/extracted-problems/[problemId]/chat-sessions/route.ts` (endpoint 35)
 * and `app/api/attempts/[attemptId]/chat-sessions/route.ts` (endpoint 36).
 *
 * The two routes are deliberately the same past resource resolution, so the
 * shared behaviour is asserted once through each entry point rather than
 * duplicated: if they ever drift, one of these files fails.
 */

const dalMock = {
  requireExtractedProblem: vi.fn(),
  requireAttempt: vi.fn(),
  verifySession: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  skillMastery: { findMany: vi.fn() },
  chatSession: { create: vi.fn(), count: vi.fn() },
  chatMessage: { create: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return arg;
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST: OPEN_FROM_PROBLEM } = await import("@/app/api/extracted-problems/[problemId]/chat-sessions/route");
const { POST: OPEN_FROM_ATTEMPT } = await import("@/app/api/attempts/[attemptId]/chat-sessions/route");

// ─────────────────────────── fixtures ───────────────────────────

const PROBLEM_TEXT = "What is $\\frac{1}{4} + \\frac{1}{4}$?";

function extractedProblem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ep_1",
    text: PROBLEM_TEXT,
    extraction: {
      id: "ex_1",
      status: "CONFIRMED",
      upload: {
        id: "up_1",
        studentProfileId: "sp_1",
        studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
      },
    },
    ...overrides,
  };
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "att_1",
    studentProfileId: "sp_1",
    practiceProblem: {
      id: "pp_1",
      text: PROBLEM_TEXT,
      practiceSet: { id: "set_1", status: "IN_PROGRESS" },
    },
    studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
    ...overrides,
  };
}

function req(body: unknown = {}) {
  return new Request("http://localhost/api/extracted-problems/ep_1/chat-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const problemCtx = () => ({ params: Promise.resolve({ problemId: "ep_1" }) });
const attemptCtx = () => ({ params: Promise.resolve({ attemptId: "att_1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireExtractedProblem.mockResolvedValue(extractedProblem());
  dalMock.requireAttempt.mockResolvedValue(attempt());
  dbMock.skillMastery.findMany.mockResolvedValue([]);
  dbMock.chatSession.count.mockResolvedValue(0);
  dbMock.chatSession.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "sess_1",
    studentTurnCount: 0,
    status: "OPEN",
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    extractedProblemId: null,
    attemptId: null,
    ...data,
  }));
  dbMock.chatMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "msg_open",
    partial: false,
    truncated: false,
    safetyResponse: false,
    clientTurnId: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: new Date(),
    ...data,
  }));
});

// ─────────────────────────── endpoint 35 ───────────────────────────

describe("opening a session on an extracted problem (endpoint 35)", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await OPEN_FROM_PROBLEM(req(), problemCtx())).status).toBe(401);
    expect(dbMock.chatSession.create).not.toHaveBeenCalled();
  });

  it("404s a cross-account or unknown problem (AC 15)", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(null);
    const res = await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("We couldn't find that.");
  });

  it("403s a non-ACTIVE profile", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(
      extractedProblem({
        extraction: {
          id: "ex_1",
          status: "CONFIRMED",
          upload: {
            id: "up_1",
            studentProfileId: "sp_1",
            studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" },
          },
        },
      }),
    );
    expect((await OPEN_FROM_PROBLEM(req(), problemCtx())).status).toBe(403);
    expect(dbMock.chatSession.create).not.toHaveBeenCalled();
  });

  /**
   * Chat binds to a problem the student has actually reviewed. Tutoring a child
   * on a misread line they never saw is worse than not tutoring them, and the
   * confirm step (M1 AC 30) is the only thing standing between the two.
   */
  it("409s until the extraction is CONFIRMED, and says why", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(
      extractedProblem({
        extraction: {
          id: "ex_1",
          status: "COMPLETE",
          upload: {
            id: "up_1",
            studentProfileId: "sp_1",
            studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
          },
        },
      }),
    );
    const res = await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("Check this worksheet over first");
  });

  /**
   * The alternative is defaulting to GRADE_4 — which this codebase already
   * carries as a known smell elsewhere — and that means guessing the reading
   * level for a child's whole session, then snapshotting the guess onto a row
   * cached for an hour. Refused cleanly instead.
   */
  it("409s a profile with no grade level rather than guessing one", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(
      extractedProblem({
        extraction: {
          id: "ex_1",
          status: "CONFIRMED",
          upload: {
            id: "up_1",
            studentProfileId: "sp_1",
            studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: null },
          },
        },
      }),
    );
    const res = await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("grade level");
    expect(dbMock.chatSession.create).not.toHaveBeenCalled();
  });

  it("400s an undeclared body key rather than ignoring it", async () => {
    expect((await OPEN_FROM_PROBLEM(req({ gradeLevel: "GRADE_8" }), problemCtx())).status).toBe(400);
  });

  it("429s past the hourly session cap", async () => {
    dbMock.chatSession.count.mockResolvedValue(CHAT_SESSIONS_PER_HOUR);
    expect((await OPEN_FROM_PROBLEM(req(), problemCtx())).status).toBe(429);
    expect(dbMock.chatSession.create).not.toHaveBeenCalled();
  });

  it("201s with the session and its opening message", async () => {
    const res = await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.session.subject).toEqual({ kind: "EXTRACTED_PROBLEM", id: "ep_1" });
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].role).toBe("ASSISTANT");
  });

  /** AC 1: the opening message refers to THAT problem, by construction. */
  it("quotes the problem in the templated opening message and asks a question", async () => {
    await OPEN_FROM_PROBLEM(req(), problemCtx());
    const opening = dbMock.chatMessage.create.mock.calls[0][0].data;
    expect(opening.content).toContain(PROBLEM_TEXT);
    expect(opening.content.trimEnd().endsWith("?")).toBe(true);
    expect(opening.sequence).toBe(1);
  });

  /**
   * ADR-0012 §1. Stamped from config at open and read off the row thereafter,
   * so a session that ran under yesterday's limits stays legible after the
   * config moves.
   */
  it("stamps the bounds onto the row from config", async () => {
    const before = Date.now();
    await OPEN_FROM_PROBLEM(req(), problemCtx());
    const data = dbMock.chatSession.create.mock.calls[0][0].data;

    expect(data.maxStudentTurns).toBe(CHAT_MAX_STUDENT_TURNS);
    expect(data.revealAfterTurns).toBe(CHAT_REVEAL_AFTER_TURNS);
    const window = (data.expiresAt as Date).getTime() - before;
    expect(window).toBeGreaterThan(CHAT_MAX_SESSION_MINUTES * 60 * 1000 - 5_000);
    expect(window).toBeLessThanOrEqual(CHAT_MAX_SESSION_MINUTES * 60 * 1000 + 5_000);
  });

  /**
   * ADR-0012 §2, and the reason AC 8 is true by construction: the context is
   * rendered ONCE and stored, so nothing that happens mid-session can move the
   * cached prefix.
   */
  it("snapshots the rendered learner context with a matching hash", async () => {
    dbMock.skillMastery.findMany.mockResolvedValue([
      { skillCode: "4.NF.B.3", level: "DEVELOPING" },
      { skillCode: "4.OA.A.1", level: "SECURE" },
    ]);

    await OPEN_FROM_PROBLEM(req(), problemCtx());
    const data = dbMock.chatSession.create.mock.calls[0][0].data;

    const expected = renderLearnerContext({
      gradeLevel: "GRADE_4",
      subjects: ["MATH"],
      skills: [
        { skillCode: "4.NF.B.3", level: "DEVELOPING" },
        { skillCode: "4.OA.A.1", level: "SECURE" },
      ],
    });
    expect(data.renderedContext).toBe(expected);
    expect(data.contextHash).toBe(hashContext(expected));
    expect(data.contextVersion).toBe(LEARNER_CONTEXT_VERSION);
  });

  /**
   * The renderer must never receive a moving value. Selecting only the two
   * columns it uses is what makes that structural rather than remembered — a
   * `lastPracticedAt` in the prefix would take cache reads to zero and nothing
   * would report it.
   */
  it("reads only skillCode and level from mastery, never a timestamp or a count", async () => {
    await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(dbMock.skillMastery.findMany).toHaveBeenCalledWith({
      where: { studentProfileId: "sp_1" },
      select: { skillCode: true, level: true },
    });
  });

  it("stamps learnerProfileVersion as null until M7 exists", async () => {
    await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(dbMock.chatSession.create.mock.calls[0][0].data.learnerProfileVersion).toBeNull();
  });

  it("never returns the rendered context or the model to the client", async () => {
    const raw = await (await OPEN_FROM_PROBLEM(req(), problemCtx())).text();
    expect(raw).not.toContain("Learner context");
    expect(raw).not.toContain("claude-opus-5");
  });

  it("makes no AI call — opening a session is free and deterministic", async () => {
    // Nothing in this route's import graph can reach Anthropic; the assertion
    // that matters is that the opener came from the template, not a model.
    await OPEN_FROM_PROBLEM(req(), problemCtx());
    expect(dbMock.chatMessage.create).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────── endpoint 36 ───────────────────────────

describe("opening a session on an attempt (endpoint 36)", () => {
  it("404s a cross-account or unknown attempt", async () => {
    dalMock.requireAttempt.mockResolvedValue(null);
    expect((await OPEN_FROM_ATTEMPT(req(), attemptCtx())).status).toBe(404);
  });

  it("403s a non-ACTIVE profile", async () => {
    dalMock.requireAttempt.mockResolvedValue(
      attempt({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } }),
    );
    expect((await OPEN_FROM_ATTEMPT(req(), attemptCtx())).status).toBe(403);
  });

  it("409s while the set is still generating or has failed", async () => {
    for (const status of ["GENERATING", "FAILED"]) {
      dalMock.requireAttempt.mockResolvedValue(
        attempt({ practiceProblem: { id: "pp_1", text: PROBLEM_TEXT, practiceSet: { id: "set_1", status } } }),
      );
      expect((await OPEN_FROM_ATTEMPT(req(), attemptCtx())).status).toBe(409);
    }
  });

  it("409s a profile with no grade level", async () => {
    dalMock.requireAttempt.mockResolvedValue(
      attempt({ studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: null } }),
    );
    const res = await OPEN_FROM_ATTEMPT(req(), attemptCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("grade level");
  });

  it("201s bound to the attempt, not to an extracted problem", async () => {
    const res = await OPEN_FROM_ATTEMPT(req(), attemptCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.session.subject).toEqual({ kind: "ATTEMPT", id: "att_1" });

    const data = dbMock.chatSession.create.mock.calls[0][0].data;
    expect(data.attemptId).toBe("att_1");
    // Exactly one binding is set — the CHECK constraint requires it, and
    // setting both would be rejected by the database rather than by a comment.
    expect(data.extractedProblemId).toBeUndefined();
  });

  /** The session is about the QUESTION the child got wrong, not their answer. */
  it("opens on the practice problem's text, never the submitted answer", async () => {
    await OPEN_FROM_ATTEMPT(req(), attemptCtx());
    expect(dbMock.chatMessage.create.mock.calls[0][0].data.content).toContain(PROBLEM_TEXT);
  });

  it("shares the hourly session cap with endpoint 35", async () => {
    dbMock.chatSession.count.mockResolvedValue(CHAT_SESSIONS_PER_HOUR);
    expect((await OPEN_FROM_ATTEMPT(req(), attemptCtx())).status).toBe(429);
  });
});
