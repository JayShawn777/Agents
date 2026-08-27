import "server-only";

import { db } from "@/lib/db";
import type { ChatMessage, ChatSession } from "@/lib/generated/prisma/client";
import type { GradeLevel } from "@/lib/domain/enums";
import { hashContext, LEARNER_CONTEXT_VERSION, renderLearnerContext } from "@/lib/chat/context";
import { loadLearnerContext } from "@/lib/chat/learner";
import { buildOpeningMessage, TUTOR_SYSTEM_PROMPT_VERSION } from "@/lib/chat/prompt";
import { toChatSessionDetail } from "@/lib/chat/dto";
import { successResponse } from "@/lib/errors";
import type { ChatSessionDetailResponse } from "@/lib/schemas/dto";
import {
  CHAT_MAX_SESSION_MINUTES,
  CHAT_MAX_STUDENT_TURNS,
  CHAT_MODEL,
  CHAT_REVEAL_AFTER_TURNS,
  CHAT_SESSIONS_PER_HOUR,
} from "@/lib/config";

/**
 * Opens one chat session (endpoints 35 and 36 both land here), and is where
 * ADR-0012's two central decisions are actually executed.
 *
 * **1. The bounds are STAMPED, not referenced.** `maxStudentTurns`,
 * `revealAfterTurns` and `expiresAt` are written onto the row from config at
 * this moment and read off the row forever after, for the same reason
 * `ParentalConsent.method` is stamped rather than re-derived (ADR-0008 §6): a
 * session that ran under yesterday's limits must stay legible after the config
 * moves, and a limit that shifts under a live conversation is a bug nobody can
 * reproduce.
 *
 * **2. The learner context is a SNAPSHOT, not a render.** It is rendered once,
 * here, and those exact bytes are sent on every turn of this session. That is
 * what makes AC 8's `cache_read_input_tokens > 0` true by construction rather
 * than by discipline: practice completed mid-session does not move the prefix,
 * a config change does not move it, and a skill reaching SECURE between turn 2
 * and turn 3 does not move it. The next session picks the change up.
 *
 * `contextHash` is stored beside the render so the two can be checked against
 * each other later — it is not a cache key and is not security-relevant.
 *
 * The whole thing is one transaction: a session row with no opening message is
 * a conversation a child opens to silence.
 */
export type OpenedChatSession = { session: ChatSession; messages: ChatMessage[] };

export type ChatSessionBinding =
  | { kind: "EXTRACTED_PROBLEM"; extractedProblemId: string }
  | { kind: "ATTEMPT"; attemptId: string };

export async function openChatSession(args: {
  studentProfileId: string;
  /** Required, never defaulted — see the route's 409 when a profile has none. */
  gradeLevel: GradeLevel;
  binding: ChatSessionBinding;
  problemText: string;
  now?: Date;
}): Promise<OpenedChatSession> {
  const now = args.now ?? new Date();

  // Read and render BEFORE the transaction: this is a pure function over rows
  // that are not being written here, and holding a transaction open across it
  // buys nothing.
  const facts = await loadLearnerContext({
    studentProfileId: args.studentProfileId,
    gradeLevel: args.gradeLevel,
  });
  const renderedContext = renderLearnerContext(facts);

  return db.$transaction(async (tx) => {
    const session = await tx.chatSession.create({
      data: {
        studentProfileId: args.studentProfileId,
        ...(args.binding.kind === "EXTRACTED_PROBLEM"
          ? { extractedProblemId: args.binding.extractedProblemId }
          : { attemptId: args.binding.attemptId }),
        maxStudentTurns: CHAT_MAX_STUDENT_TURNS,
        revealAfterTurns: CHAT_REVEAL_AFTER_TURNS,
        expiresAt: new Date(now.getTime() + CHAT_MAX_SESSION_MINUTES * 60 * 1000),
        renderedContext,
        contextHash: hashContext(renderedContext),
        contextVersion: LEARNER_CONTEXT_VERSION,
        // NULL until M7 exists — the learner-profile summary it will add to the
        // context does not exist yet, and stamping a 0 would claim it does.
        learnerProfileVersion: null,
        systemPromptVersion: TUTOR_SYSTEM_PROMPT_VERSION,
        // Stamped so a transcript stays interpretable after the constant moves:
        // you can always tell which model produced a given conversation.
        model: CHAT_MODEL,
        openedAt: now,
      },
    });

    // Sequence 1. The student's first message will be 2, its reply 3.
    const opening = await tx.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: buildOpeningMessage(args.problemText),
        sequence: 1,
      },
    });

    return { session, messages: [opening] };
  });
}

/**
 * The open cap, shared by endpoints 35 and 36 so the two entry points cannot
 * drift into two different ceilings.
 *
 * Opening a session is free — the opener is templated and no model is called —
 * so this is not a spend limit on itself. It is a limit on what each open
 * LICENSES: every session is a fresh grant of `CHAT_MESSAGES_PER_HOUR` worth of
 * turns, so without this a caller can reset the message cap by opening a new
 * session, and the message cap becomes decorative.
 */
export async function withinSessionOpenCap(studentProfileId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const count = await db.chatSession.count({
    where: { studentProfileId, openedAt: { gte: windowStart } },
  });
  return count < CHAT_SESSIONS_PER_HOUR;
}

/** The 201 both open endpoints return. One shape, built in one place. */
export function openedSessionResponse(opened: OpenedChatSession): Response {
  const body: ChatSessionDetailResponse = toChatSessionDetail(opened.session, opened.messages);
  return successResponse(body, { status: 201 });
}
