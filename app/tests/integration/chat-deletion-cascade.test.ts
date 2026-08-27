import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { deleteStudentData } = await import("@/lib/deletion/service");
const { createFakeStorage } = await import("../unit/mocks/fake-storage");

/**
 * M3 AC 16, against the real database — the test the M3 build shipped without,
 * found in review.
 *
 * **Why its absence mattered.** Plan §6.1 lists it by name ("Cascades: profile
 * deletion and source-problem deletion each remove sessions and messages"), and
 * this is the third time this exact gap has appeared in this project: ADR-0017's
 * checkpoint cascade was half-tested and the M2.5 review had to add the other
 * half. A cascade is declared in `schema.prisma` as `onDelete: Cascade` and then
 * believed. Nothing in the unit suite touches a foreign key, so every mocked
 * test passes whether or not the database would actually delete anything.
 *
 * It matters more here than anywhere else in the app. Chat messages are
 * unbounded free text authored by a child — the spec's own data table rates
 * them the most sensitive category in the product — and AC 16 is one of the
 * four paths COPPA §312.6 deletion actually runs through. A cascade that
 * silently does not fire leaves a child's conversations in the database after a
 * parent has asked for them to be gone.
 *
 * THREE paths, because they reach the rows differently:
 *   1. Deleting the EXTRACTED PROBLEM a session is bound to.
 *   2. Deleting the ATTEMPT a session is bound to (the other binding, which any
 *      deletion walking uploads and extractions misses by construction — a
 *      session bound to an attempt has no `extractedProblemId` at all).
 *   3. Deleting the STUDENT PROFILE via `deleteStudentData`, the one function
 *      that destroys a student's data (ADR-0007 §4).
 */
describe("M3 chat data — deletion cascades against real Postgres", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function makeFixture() {
    const user = await db.user.create({
      data: { email: `chat-cascade-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/chat-cascade-${Date.now()}-${Math.random()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalFilename: "x.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });
    const extractedProblem = await db.extractedProblem.create({
      data: { extractionId: extraction.id, ordinal: 1, text: "What is 1/4 + 1/4?", confidence: 0.9 },
    });

    // The attempt binding needs a whole practice chain behind it.
    const set = await db.practiceSet.create({
      data: {
        studentProfileId: profile.id,
        extractionId: extraction.id,
        status: "READY",
        model: "claude-opus-5",
        effort: "high",
        promptVersion: "test",
        taxonomyVersion: "test",
      },
    });
    const practiceProblem = await db.practiceProblem.create({
      data: { practiceSetId: set.id, ordinal: 1, skillCode: "4.NF.B.3", text: "test", answerFormat: "NUMERIC" },
    });
    const attempt = await db.attempt.create({
      data: {
        practiceProblemId: practiceProblem.id,
        studentProfileId: profile.id,
        attemptNumber: 1,
        submittedAnswer: "2/8",
        result: "INCORRECT",
        gradedBy: "NORMALIZER",
      },
    });

    const sessionDefaults = {
      studentProfileId: profile.id,
      maxStudentTurns: 20,
      revealAfterTurns: 3,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      renderedContext: "Learner context (m3.1).\n",
      contextHash: "hash",
      contextVersion: "m3.1",
      systemPromptVersion: "m3.1",
      model: "claude-opus-5",
    };

    const problemSession = await db.chatSession.create({
      data: { ...sessionDefaults, extractedProblemId: extractedProblem.id },
    });
    const attemptSession = await db.chatSession.create({
      data: { ...sessionDefaults, attemptId: attempt.id },
    });

    // One message in each, carrying the thing AC 16 is really about: text a
    // child typed.
    const problemMessage = await db.chatMessage.create({
      data: { sessionId: problemSession.id, role: "USER", content: "i dont get it", sequence: 1 },
    });
    const attemptMessage = await db.chatMessage.create({
      data: { sessionId: attemptSession.id, role: "USER", content: "why is it wrong", sequence: 1 },
    });

    return {
      profile,
      extractedProblem,
      attempt,
      problemSession,
      attemptSession,
      problemMessage,
      attemptMessage,
    };
  }

  it("deleting the EXTRACTED PROBLEM removes the session bound to it, and its messages", async () => {
    const fixture = await makeFixture();

    await db.extractedProblem.delete({ where: { id: fixture.extractedProblem.id } });

    await expect(db.chatSession.findUnique({ where: { id: fixture.problemSession.id } })).resolves.toBeNull();
    await expect(db.chatMessage.findUnique({ where: { id: fixture.problemMessage.id } })).resolves.toBeNull();

    // And it did NOT reach the session bound to the attempt — a different
    // subject, a different parent, and a deletion that took both would be
    // destroying data nobody asked to remove.
    await expect(db.chatSession.findUnique({ where: { id: fixture.attemptSession.id } })).resolves.not.toBeNull();
  });

  /**
   * The half that is easiest to miss. A session bound to an ATTEMPT has no
   * `extractedProblemId`, so any deletion routine that walks uploads and
   * extractions never reaches it — the same construction that hid M2.5's
   * checkpoint cascade.
   */
  it("deleting the ATTEMPT removes the session bound to it, and its messages", async () => {
    const fixture = await makeFixture();

    await db.attempt.delete({ where: { id: fixture.attempt.id } });

    await expect(db.chatSession.findUnique({ where: { id: fixture.attemptSession.id } })).resolves.toBeNull();
    await expect(db.chatMessage.findUnique({ where: { id: fixture.attemptMessage.id } })).resolves.toBeNull();
    await expect(db.chatSession.findUnique({ where: { id: fixture.problemSession.id } })).resolves.not.toBeNull();
  });

  /**
   * The COPPA path (M0 AC 46/48, ADR-0007 §4). Both bindings must go, and the
   * child's own words with them.
   */
  it("deleting the STUDENT PROFILE removes every session and every message, under both bindings", async () => {
    const fixture = await makeFixture();
    const storage = createFakeStorage([]);

    const result = await deleteStudentData(fixture.profile.id, "PROFILE_DELETED", storage);
    expect(result.ok).toBe(true);

    await expect(db.studentProfile.findUnique({ where: { id: fixture.profile.id } })).resolves.toBeNull();
    await expect(db.chatSession.findUnique({ where: { id: fixture.problemSession.id } })).resolves.toBeNull();
    await expect(db.chatSession.findUnique({ where: { id: fixture.attemptSession.id } })).resolves.toBeNull();
    await expect(db.chatMessage.findUnique({ where: { id: fixture.problemMessage.id } })).resolves.toBeNull();
    await expect(db.chatMessage.findUnique({ where: { id: fixture.attemptMessage.id } })).resolves.toBeNull();

    // Asserted as a SET, not row by row: the question AC 16 asks is "is any of
    // this child's conversation still here", and a count is the only form of
    // that question a future column cannot slip past.
    const strayMessages = await db.chatMessage.count({
      where: { session: { studentProfileId: fixture.profile.id } },
    });
    const straySessions = await db.chatSession.count({ where: { studentProfileId: fixture.profile.id } });
    expect(strayMessages).toBe(0);
    expect(straySessions).toBe(0);
  });
});
