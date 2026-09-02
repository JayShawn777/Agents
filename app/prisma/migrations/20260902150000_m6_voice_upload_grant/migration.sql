-- CreateEnum
CREATE TYPE "VoiceUploadPurpose" AS ENUM ('CONSENT_STATEMENT', 'VOICE_SAMPLE');

-- CreateTable
CREATE TABLE "VoiceUploadGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "VoiceUploadPurpose" NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceUploadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceUploadGrant_pathname_key" ON "VoiceUploadGrant"("pathname");

-- CreateIndex
CREATE INDEX "VoiceUploadGrant_userId_createdAt_idx" ON "VoiceUploadGrant"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "VoiceUploadGrant" ADD CONSTRAINT "VoiceUploadGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

