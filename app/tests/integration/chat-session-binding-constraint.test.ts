import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");

/**
 * M3 AC 1's binding rule, against real Postgres.
 *
 * `ChatSession` carries two nullable foreign keys — `extractedProblemId` and
 * `attemptId` — and exactly one must be set. Prisma cannot express that, so the
 * migration is hand-edited to add
 *   CHECK (num_nonnulls("extractedProblemId", "attemptId") = 1)
 * and a reader of `schema.prisma` sees only two independent optional columns.
 * This file is the constraint's documentation, the same arrangement ADR-0017
 * established for `PracticeSet.kind`.
 *
 * Both failure directions matter and they fail differently. NEITHER set is a
 * session about nothing, which is exactly the free-chat surface M3's non-goals
 * forbid. BOTH set makes "which problem is this about" ambiguous, and AC 16's
 * cascade would then depend on which parent happened to be deleted first.
 */
describe("a chat session is bound to exactly one subject", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function fixture() {
    const user = await db.user.create({
      data: { email: `chat-binding-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);
    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/chat-${Date.now()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalFilename: "x.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });
    const problem = await db.extractedProblem.create({
      data: { extractionId: extraction.id, ordinal: 1, text: "What is 1/2 + 1/4?", confidence: 0.9 },
    });
    return { profile, problem };
  }

  /** Everything ADR-0012 §1 stamps at open. Values are irrelevant to the constraint. */
  const stamped = {
    maxStudentTurns: 20,
    revealAfterTurns: 3,
    expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    renderedContext: "grade 4; fractions",
    contextHash: "hash",
    contextVersion: "v1",
    systemPromptVersion: "v1",
    model: "claude-opus-5",
  };

  it("accepts a session bound to an extracted problem", async () => {
    const { profile, problem } = await fixture();
    const session = await db.chatSession.create({
      data: { studentProfileId: profile.id, extractedProblemId: problem.id, ...stamped },
    });

    expect(session.extractedProblemId).toBe(problem.id);
    expect(session.attemptId).toBeNull();
  });

  it("REJECTS a session bound to nothing — that is the free-chat surface the spec forbids", async () => {
    const { profile } = await fixture();
    await expect(
      db.chatSession.create({ data: { studentProfileId: profile.id, ...stamped } }),
    ).rejects.toThrow(/chat_session_exactly_one_subject/);
  });

  it("REJECTS a session bound to BOTH — 'which problem is this about' must have one answer", async () => {
    const { profile, problem } = await fixture();
    const set = await db.practiceSet.create({
      data: {
        studentProfileId: profile.id,
        kind: "CHECKPOINT",
        status: "READY",
        model: "claude-opus-5",
        effort: "high",
        promptVersion: "t",
        taxonomyVersion: "t",
      },
    });
    const practiceProblem = await db.practiceProblem.create({
      data: { practiceSetId: set.id, ordinal: 1, skillCode: "4.NF.B.3", text: "x", answerFormat: "FRACTION", choices: [] },
    });
    const attempt = await db.attempt.create({
      data: {
        practiceProblemId: practiceProblem.id,
        studentProfileId: profile.id,
        attemptNumber: 1,
        submittedAnswer: "3/4",
        result: "CORRECT",
        gradedBy: "NORMALIZER",
      },
    });

    await expect(
      db.chatSession.create({
        data: { studentProfileId: profile.id, extractedProblemId: problem.id, attemptId: attempt.id, ...stamped },
      }),
    ).rejects.toThrow(/chat_session_exactly_one_subject/);
  });

  it("REJECTS an UPDATE that would unbind a session, not only an insert", async () => {
    const { profile, problem } = await fixture();
    const session = await db.chatSession.create({
      data: { studentProfileId: profile.id, extractedProblemId: problem.id, ...stamped },
    });

    await expect(
      db.chatSession.update({ where: { id: session.id }, data: { extractedProblemId: null } }),
    ).rejects.toThrow(/chat_session_exactly_one_subject/);
  });

  it("AC 16: deleting the bound extracted problem removes the session and its messages", async () => {
    const { profile, problem } = await fixture();
    const session = await db.chatSession.create({
      data: { studentProfileId: profile.id, extractedProblemId: problem.id, ...stamped },
    });
    await db.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: "why do I flip it?", sequence: 1 },
    });

    await db.extractedProblem.delete({ where: { id: problem.id } });

    expect(await db.chatSession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await db.chatMessage.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it("AC 16: deleting the student profile removes the session and its messages", async () => {
    const { profile, problem } = await fixture();
    const session = await db.chatSession.create({
      data: { studentProfileId: profile.id, extractedProblemId: problem.id, ...stamped },
    });
    await db.chatMessage.create({
      data: { sessionId: session.id, role: "ASSISTANT", content: "what have you tried?", sequence: 1 },
    });

    await db.studentProfile.delete({ where: { id: profile.id } });

    expect(await db.chatSession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await db.chatMessage.count({ where: { sessionId: session.id } })).toBe(0);
  });
});
