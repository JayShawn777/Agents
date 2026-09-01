-- CreateEnum
CREATE TYPE "NarrationStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "captionsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "personaId" TEXT;

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "artworkId" TEXT NOT NULL,
    "providerVoiceId" TEXT NOT NULL,
    "ttsProvider" TEXT NOT NULL DEFAULT 'elevenlabs',
    "sortOrder" INTEGER NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonNarration" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "personaId" TEXT,
    "status" "NarrationStatus" NOT NULL DEFAULT 'PENDING',
    "ttsModelId" TEXT NOT NULL,
    "providerVoiceId" TEXT NOT NULL,
    "cueFormatVersion" TEXT NOT NULL,
    "failureCode" TEXT,
    "stepCount" INTEGER,
    "totalDurationMs" INTEGER,
    "charactersBilled" INTEGER,
    "cacheHits" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonNarration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonNarrationStep" (
    "id" TEXT NOT NULL,
    "narrationId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "startOffsetMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonNarrationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrationAsset" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "personaId" TEXT,
    "cacheKey" TEXT NOT NULL,
    "providerVoiceId" TEXT NOT NULL,
    "ttsModelId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "characterCount" INTEGER NOT NULL,
    "cues" JSONB NOT NULL,
    "cueFormatVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrationAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Persona_slug_key" ON "Persona"("slug");

-- CreateIndex
CREATE INDEX "Persona_retiredAt_sortOrder_idx" ON "Persona"("retiredAt", "sortOrder");

-- CreateIndex
CREATE INDEX "LessonNarration_status_updatedAt_idx" ON "LessonNarration"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LessonNarration_studentProfileId_createdAt_idx" ON "LessonNarration"("studentProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LessonNarration_versionId_key" ON "LessonNarration"("versionId");

-- CreateIndex
CREATE INDEX "LessonNarrationStep_assetId_idx" ON "LessonNarrationStep"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonNarrationStep_narrationId_stepIndex_key" ON "LessonNarrationStep"("narrationId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "NarrationAsset_pathname_key" ON "NarrationAsset"("pathname");

-- CreateIndex
CREATE INDEX "NarrationAsset_providerVoiceId_idx" ON "NarrationAsset"("providerVoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "NarrationAsset_studentProfileId_cacheKey_key" ON "NarrationAsset"("studentProfileId", "cacheKey");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonNarration" ADD CONSTRAINT "LessonNarration_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonNarration" ADD CONSTRAINT "LessonNarration_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonNarrationStep" ADD CONSTRAINT "LessonNarrationStep_narrationId_fkey" FOREIGN KEY ("narrationId") REFERENCES "LessonNarration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonNarrationStep" ADD CONSTRAINT "LessonNarrationStep_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "NarrationAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrationAsset" ADD CONSTRAINT "NarrationAsset_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrationAsset" ADD CONSTRAINT "NarrationAsset_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;
