-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('PENDING', 'AUTHORING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "LessonFlagReason" AS ENUM ('CONFUSING', 'TOO_FAST', 'WRONG', 'NOT_MY_PROBLEM');

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "extractedProblemId" TEXT,
    "practiceProblemId" TEXT,
    "status" "LessonStatus" NOT NULL DEFAULT 'PENDING',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonScriptVersion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LessonStatus" NOT NULL,
    "script" JSONB,
    "schemaVersion" TEXT NOT NULL,
    "stepCount" INTEGER,
    "totalDurationMs" INTEGER,
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "failureCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonFlag" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepIndex" INTEGER,
    "reason" "LessonFlagReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_currentVersionId_key" ON "Lesson"("currentVersionId");

-- CreateIndex
CREATE INDEX "Lesson_studentProfileId_createdAt_idx" ON "Lesson"("studentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Lesson_status_updatedAt_idx" ON "Lesson"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LessonScriptVersion_lessonId_createdAt_idx" ON "LessonScriptVersion"("lessonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LessonScriptVersion_lessonId_version_key" ON "LessonScriptVersion"("lessonId", "version");

-- CreateIndex
CREATE INDEX "LessonFlag_lessonId_createdAt_idx" ON "LessonFlag"("lessonId", "createdAt");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_extractedProblemId_fkey" FOREIGN KEY ("extractedProblemId") REFERENCES "ExtractedProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_practiceProblemId_fkey" FOREIGN KEY ("practiceProblemId") REFERENCES "PracticeProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonScriptVersion" ADD CONSTRAINT "LessonScriptVersion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonFlag" ADD CONSTRAINT "LessonFlag_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- M4 AC 5 / AC 21: a lesson is about exactly ONE problem.
--
-- Prisma cannot express "exactly one of these two nullable foreign keys", so
-- this is hand-added to the generated SQL, the same arrangement ADR-0017
-- established for PracticeSet.kind and ADR-0014 repeats here. A reader of
-- schema.prisma sees only two independent optional columns; the integration
-- test is this constraint documentation.
--
-- NEITHER set is a lesson about nothing. BOTH set makes "which problem is this
-- explaining" ambiguous, and AC 21 cascade would then depend on which parent
-- happened to be deleted first.
--
-- Column names are camelCase because that is what Prisma generates; the plan
-- carried snake_case SQL for the M3 equivalent and it would not have applied.
ALTER TABLE "Lesson"
  ADD CONSTRAINT "Lesson_exactly_one_subject"
  CHECK (num_nonnulls("extractedProblemId", "practiceProblemId") = 1);
