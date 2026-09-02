-- CreateEnum
CREATE TYPE "PersonaStatus" AS ENUM ('ACTIVE', 'PENDING_VERIFICATION', 'REVOKED');

-- CreateEnum
CREATE TYPE "VoiceAuditEvent" AS ENUM ('CREATED', 'REVOKED', 'DELETED', 'VENDOR_DELETE_FAILED');

-- AlterEnum
ALTER TYPE "ConsentScope" ADD VALUE 'VOICE_CLONING';

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "status" "PersonaStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "VoiceConsentRecording" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "consentWordingVersion" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "resultingProviderVoiceId" TEXT,
    "parentalConsentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceConsentRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomVoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "voiceConsentRecordingId" TEXT NOT NULL,
    "samplePathname" TEXT,
    "sampleDeletedAt" TIMESTAMP(3),
    "providerVoiceId" TEXT NOT NULL,
    "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomVoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCreationAudit" (
    "id" TEXT NOT NULL,
    "event" "VoiceAuditEvent" NOT NULL,
    "userId" TEXT,
    "actorHash" TEXT NOT NULL,
    "providerVoiceId" TEXT NOT NULL,
    "consentWordingVersion" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCreationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceConsentRecording_pathname_key" ON "VoiceConsentRecording"("pathname");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceConsentRecording_parentalConsentId_key" ON "VoiceConsentRecording"("parentalConsentId");

-- CreateIndex
CREATE INDEX "VoiceConsentRecording_userId_createdAt_idx" ON "VoiceConsentRecording"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomVoice_personaId_key" ON "CustomVoice"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomVoice_voiceConsentRecordingId_key" ON "CustomVoice"("voiceConsentRecordingId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomVoice_samplePathname_key" ON "CustomVoice"("samplePathname");

-- CreateIndex
CREATE INDEX "CustomVoice_userId_idx" ON "CustomVoice"("userId");

-- CreateIndex
CREATE INDEX "CustomVoice_providerVoiceId_idx" ON "CustomVoice"("providerVoiceId");

-- CreateIndex
CREATE INDEX "VoiceCreationAudit_providerVoiceId_idx" ON "VoiceCreationAudit"("providerVoiceId");

-- CreateIndex
CREATE INDEX "VoiceCreationAudit_event_occurredAt_idx" ON "VoiceCreationAudit"("event", "occurredAt");

-- CreateIndex
CREATE INDEX "Persona_ownerUserId_status_idx" ON "Persona"("ownerUserId", "status");

-- AddForeignKey
ALTER TABLE "VoiceConsentRecording" ADD CONSTRAINT "VoiceConsentRecording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceConsentRecording" ADD CONSTRAINT "VoiceConsentRecording_parentalConsentId_fkey" FOREIGN KEY ("parentalConsentId") REFERENCES "ParentalConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomVoice" ADD CONSTRAINT "CustomVoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomVoice" ADD CONSTRAINT "CustomVoice_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomVoice" ADD CONSTRAINT "CustomVoice_voiceConsentRecordingId_fkey" FOREIGN KEY ("voiceConsentRecordingId") REFERENCES "VoiceConsentRecording"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

