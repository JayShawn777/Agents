-- CreateEnum
CREATE TYPE "PracticeSetStatus" AS ENUM ('GENERATING', 'READY', 'IN_PROGRESS', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "AnswerFormat" AS ENUM ('NUMERIC', 'EXPRESSION', 'FRACTION', 'SHORT_TEXT', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('CORRECT', 'INCORRECT', 'UNSCORED');

-- CreateEnum
CREATE TYPE "GradedBy" AS ENUM ('NORMALIZER', 'MODEL', 'UNGRADED');

-- CreateEnum
CREATE TYPE "MasteryLevel" AS ENUM ('NOT_STARTED', 'BEGINNING', 'DEVELOPING', 'SECURE');

-- CreateTable
CREATE TABLE "PracticeSet" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "status" "PracticeSetStatus" NOT NULL DEFAULT 'GENERATING',
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "taxonomyVersion" TEXT NOT NULL,
    "generationAttempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeProblem" (
    "id" TEXT NOT NULL,
    "practiceSetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "sourceExtractedProblemId" TEXT,
    "skillCode" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "containsMath" BOOLEAN NOT NULL DEFAULT false,
    "answerFormat" "AnswerFormat" NOT NULL,
    "choices" TEXT[],
    "difficultyOffset" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeAnswerKey" (
    "practiceProblemId" TEXT NOT NULL,
    "canonicalAnswer" TEXT NOT NULL,
    "acceptedForms" TEXT[],
    "workedSolution" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeAnswerKey_pkey" PRIMARY KEY ("practiceProblemId")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "practiceProblemId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "submittedAnswer" TEXT NOT NULL,
    "result" "AttemptResult" NOT NULL,
    "gradedBy" "GradedBy" NOT NULL,
    "hint" TEXT,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "elapsedMs" INTEGER,
    "appliedToMasteryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillMastery" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "skillCode" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
    "streakStartPracticeSetId" TEXT,
    "modelGradedCount" INTEGER NOT NULL DEFAULT 0,
    "level" "MasteryLevel" NOT NULL DEFAULT 'NOT_STARTED',
    "levelReachedAt" TIMESTAMP(3),
    "lastPracticedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillMastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeSet_studentProfileId_createdAt_idx" ON "PracticeSet"("studentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeSet_extractionId_idx" ON "PracticeSet"("extractionId");

-- CreateIndex
CREATE INDEX "PracticeSet_status_startedAt_idx" ON "PracticeSet"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PracticeProblem_skillCode_idx" ON "PracticeProblem"("skillCode");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeProblem_practiceSetId_ordinal_key" ON "PracticeProblem"("practiceSetId", "ordinal");

-- CreateIndex
CREATE INDEX "Attempt_studentProfileId_createdAt_idx" ON "Attempt"("studentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_practiceProblemId_createdAt_idx" ON "Attempt"("practiceProblemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_practiceProblemId_attemptNumber_key" ON "Attempt"("practiceProblemId", "attemptNumber");

-- CreateIndex
CREATE INDEX "SkillMastery_studentProfileId_level_idx" ON "SkillMastery"("studentProfileId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "SkillMastery_studentProfileId_skillCode_key" ON "SkillMastery"("studentProfileId", "skillCode");

-- AddForeignKey
ALTER TABLE "PracticeSet" ADD CONSTRAINT "PracticeSet_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSet" ADD CONSTRAINT "PracticeSet_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeProblem" ADD CONSTRAINT "PracticeProblem_practiceSetId_fkey" FOREIGN KEY ("practiceSetId") REFERENCES "PracticeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeProblem" ADD CONSTRAINT "PracticeProblem_sourceExtractedProblemId_fkey" FOREIGN KEY ("sourceExtractedProblemId") REFERENCES "ExtractedProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAnswerKey" ADD CONSTRAINT "PracticeAnswerKey_practiceProblemId_fkey" FOREIGN KEY ("practiceProblemId") REFERENCES "PracticeProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_practiceProblemId_fkey" FOREIGN KEY ("practiceProblemId") REFERENCES "PracticeProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillMastery" ADD CONSTRAINT "SkillMastery_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

