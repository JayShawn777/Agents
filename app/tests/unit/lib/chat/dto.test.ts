import { expect, it } from "vitest";

import { toChatMessageDTO, toChatSessionDTO } from "@/lib/chat/dto";
import type { ChatMessage, ChatSession } from "@/lib/generated/prisma/client";

/** `lib/chat/dto.ts` — plan §3.3's DTOs. */

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "sess_1",
    studentProfileId: "sp_1",
    extractedProblemId: "ep_1",
    attemptId: null,
    status: "OPEN",
    studentTurnCount: 2,
    maxStudentTurns: 20,
    revealAfterTurns: 3,
    expiresAt: new Date("2026-08-28T10:20:00Z"),
    renderedContext: "Learner context (m3.1).\n\nGrade level: Grade 4.\n",
    contextHash: "abc123",
    contextVersion: "m3.1",
    learnerProfileVersion: null,
    systemPromptVersion: "m3.1",
    model: "claude-opus-5",
    openedAt: new Date("2026-08-28T10:00:00Z"),
    closedAt: null,
    createdAt: new Date("2026-08-28T10:00:00Z"),
    updatedAt: new Date("2026-08-28T10:00:00Z"),
    ...overrides,
  } as ChatSession;
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg_1",
    sessionId: "sess_1",
    role: "ASSISTANT",
    content: "Where do you think it goes wrong?",
    sequence: 2,
    partial: false,
    truncated: false,
    safetyResponse: false,
    clientTurnId: null,
    inputTokens: 1_742,
    outputTokens: 40,
    cacheReadTokens: 1_700,
    cacheWriteTokens: 0,
    createdAt: new Date("2026-08-28T10:00:05Z"),
    ...overrides,
  } as ChatMessage;
}

/**
 * The key-set assertions are the point of this file, not a snapshot of today's
 * output. A DTO widened by a future convenience is how a server-only field
 * reaches a browser, and it is invisible in review unless something fails.
 */
it("ChatSessionDTO has exactly the contracted keys", () => {
  expect(Object.keys(toChatSessionDTO(session())).sort()).toEqual(
    [
      "closedAt",
      "expiresAt",
      "id",
      "maxStudentTurns",
      "openedAt",
      "status",
      "studentTurnCount",
      "subject",
    ].sort(),
  );
});

/**
 * `renderedContext` is the student's grade and per-skill mastery summary,
 * rendered as prose for a model. It is not copy anybody wrote for a child to
 * read, and ADR-0012 §2 keeps it server-side. `contextHash`, `contextVersion`,
 * `systemPromptVersion` and `model` describe how we called a vendor.
 */
it("never leaks the rendered learner context or any vendor detail", () => {
  const payload = JSON.stringify(toChatSessionDTO(session()));
  expect(payload).not.toContain("Learner context");
  expect(payload).not.toContain("abc123");
  expect(payload).not.toContain("claude-opus-5");
  expect(payload).not.toContain("m3.1");
});

it("reports the binding as a discriminated subject, for either kind", () => {
  expect(toChatSessionDTO(session()).subject).toEqual({ kind: "EXTRACTED_PROBLEM", id: "ep_1" });
  expect(toChatSessionDTO(session({ extractedProblemId: null, attemptId: "att_1" })).subject).toEqual({
    kind: "ATTEMPT",
    id: "att_1",
  });
});

it("ChatMessageDTO has exactly the contracted keys", () => {
  expect(Object.keys(toChatMessageDTO(message())).sort()).toEqual(
    [
      "contentHtml",
      "content",
      "createdAt",
      "id",
      "partial",
      "role",
      "safetyResponse",
      "sequence",
      "truncated",
    ].sort(),
  );
});

it("never carries token counts or cache metrics", () => {
  const payload = JSON.stringify(toChatMessageDTO(message()));
  expect(payload).not.toContain("1742");
  expect(payload).not.toContain("1700");
  expect(payload).not.toContain("inputTokens");
  expect(payload).not.toContain("cacheReadTokens");
});

it("never carries the clientTurnId", () => {
  const payload = JSON.stringify(
    toChatMessageDTO(message({ role: "USER", clientTurnId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" })),
  );
  expect(payload).not.toContain("3f2504e0");
});

it("renders assistant math as KaTeX (AC 17)", () => {
  const dto = toChatMessageDTO(message({ content: "Try $\\frac{1}{4}$ first." }));
  expect(dto.contentHtml).toContain("katex");
});

/**
 * A student's message is unbounded free text typed by a child. Running it
 * through a LaTeX renderer means "I have $5 and my sister has $3" is silently
 * reinterpreted as notation. AC 17 is about the tutor's replies.
 */
it("leaves a student's own message as plain text, dollar signs and all", () => {
  const dto = toChatMessageDTO(message({ role: "USER", content: "I have $5 and my sister has $3" }));
  expect(dto.contentHtml).toBeNull();
  expect(dto.content).toBe("I have $5 and my sister has $3");
});

it("renders no HTML for an empty assistant placeholder", () => {
  expect(toChatMessageDTO(message({ content: "", partial: true })).contentHtml).toBeNull();
});

it("carries the partial and truncated flags a client needs to mark a reply incomplete", () => {
  expect(toChatMessageDTO(message({ partial: true })).partial).toBe(true);
  expect(toChatMessageDTO(message({ truncated: true })).truncated).toBe(true);
});
