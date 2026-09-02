-- CreateTable
CREATE TABLE "NarrationRunAttempt" (
    "id" TEXT NOT NULL,
    "narrationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "charactersBilled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrationRunAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NarrationRunAttempt_studentProfileId_createdAt_idx" ON "NarrationRunAttempt"("studentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "NarrationRunAttempt_narrationId_idx" ON "NarrationRunAttempt"("narrationId");

-- AddForeignKey
ALTER TABLE "NarrationRunAttempt" ADD CONSTRAINT "NarrationRunAttempt_narrationId_fkey" FOREIGN KEY ("narrationId") REFERENCES "LessonNarration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrationRunAttempt" ADD CONSTRAINT "NarrationRunAttempt_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

