-- CreateEnum
CREATE TYPE "ChatSessionStatus" AS ENUM ('OPEN', 'CLOSED_TURN_LIMIT', 'CLOSED_TIME_LIMIT', 'CLOSED_BY_STUDENT');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- DropIndex
DROP INDEX "PracticeSet_studentProfileId_kind_createdAt_idx";

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "extractedProblemId" TEXT,
    "attemptId" TEXT,
    "status" "ChatSessionStatus" NOT NULL DEFAULT 'OPEN',
    "studentTurnCount" INTEGER NOT NULL DEFAULT 0,
    "maxStudentTurns" INTEGER NOT NULL,
    "revealAfterTurns" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "renderedContext" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "contextVersion" TEXT NOT NULL,
    "learnerProfileVersion" INTEGER,
    "systemPromptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "safetyResponse" BOOLEAN NOT NULL DEFAULT false,
    "clientTurnId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_studentProfileId_openedAt_idx" ON "ChatSession"("studentProfileId", "openedAt");

-- CreateIndex
CREATE INDEX "ChatSession_status_expiresAt_idx" ON "ChatSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_sequence_key" ON "ChatMessage"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_clientTurnId_key" ON "ChatMessage"("sessionId", "clientTurnId");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_extractedProblemId_fkey" FOREIGN KEY ("extractedProblemId") REFERENCES "ExtractedProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written below this line. Prisma cannot express a CHECK constraint in
-- schema.prisma, so this is invisible to a reader of that file — the same
-- situation ADR-0017 created for PracticeSet.kind, and the same answer:
-- `tests/integration/chat-session-binding-constraint.test.ts` is what makes the
-- guarantee real rather than a comment.
--
-- M3 AC 1: a session is bound to exactly ONE subject — an extracted problem or
-- a practice attempt, never both and never neither. Neither would be a session
-- about nothing, which AC 5's "no free chat surface" forbids; both would make
-- "which problem is this about" ambiguous, and AC 16's cascade would then
-- depend on which parent happened to be deleted first.
--
-- Column names are quoted and camelCase because that is what Prisma generates.
-- The plan (§1.2) wrote them snake_case, which would not have applied.
ALTER TABLE "ChatSession" ADD CONSTRAINT "chat_session_exactly_one_subject"
  CHECK (num_nonnulls("extractedProblemId", "attemptId") = 1);
