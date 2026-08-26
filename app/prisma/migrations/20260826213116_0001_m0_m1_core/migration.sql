-- CreateEnum
CREATE TYPE "GradeLevel" AS ENUM ('KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6', 'GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12', 'ADULT_LEARNER');

-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('UNDER_13', 'AGE_13_17', 'ADULT');

-- CreateEnum
CREATE TYPE "Subject" AS ENUM ('MATH', 'SCIENCE', 'ENGLISH_LANGUAGE_ARTS', 'READING', 'WRITING', 'HISTORY', 'SOCIAL_STUDIES', 'FOREIGN_LANGUAGE', 'COMPUTER_SCIENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentProfileStatus" AS ENUM ('NOTICE_PENDING', 'CONSENT_PENDING', 'ACTIVE', 'CONSENT_WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentRelationship" AS ENUM ('PARENT', 'LEGAL_GUARDIAN', 'OTHER_CAREGIVER', 'SELF');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('DATA_PROCESSING');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('SIGNED_FORM', 'PAYMENT_CARD', 'TOLL_FREE_PHONE', 'VIDEO_CONFERENCE', 'GOV_ID_CHECK', 'KBA', 'FMVPI', 'EMAIL_PLUS', 'TEXT_PLUS');

-- CreateEnum
CREATE TYPE "DeletionKind" AS ENUM ('ACCOUNT_CLOSURE', 'PARENTAL_DELETION_REQUEST', 'PROFILE_DELETED', 'PRE_CONSENT_PURGE', 'RETENTION_EXPIRY');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'STORED', 'FAILED', 'SOURCE_DELETED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'COMPLETE_EMPTY', 'FAILED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "adultAttestedAt" TIMESTAMP(3),
    "closureRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "AdultAttestation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AdultAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ageBand" "AgeBand" NOT NULL,
    "status" "StudentProfileStatus" NOT NULL DEFAULT 'NOTICE_PENDING',
    "displayName" TEXT,
    "gradeLevel" "GradeLevel",
    "subjects" "Subject"[],
    "avatarId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectNotice" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "presentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "emailDeliveryRef" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "DirectNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentalConsent" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "directNoticeId" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "consentingAdultName" TEXT NOT NULL,
    "relationship" "ConsentRelationship" NOT NULL,
    "scopes" "ConsentScope"[],
    "consentTextVersion" TEXT NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "methodEvidence" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "supersedesConsentId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ParentalConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentVerificationChallenge" (
    "id" TEXT NOT NULL,
    "parentalConsentId" TEXT NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentVerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadTokenGrant" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "requestedPathname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadTokenGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "extractedAt" TIMESTAMP(3),
    "sourceDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedProblem" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "label" TEXT,
    "text" TEXT NOT NULL,
    "containsMath" BOOLEAN NOT NULL DEFAULT false,
    "subject" "Subject",
    "problemType" TEXT,
    "studentAnswerText" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "studentCorrected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionAudit" (
    "id" TEXT NOT NULL,
    "kind" "DeletionKind" NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeletionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAuditArtifact" (
    "id" TEXT NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "adultIdentityHash" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentAuditArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_closureRequestedAt_idx" ON "User"("closureRequestedAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "AdultAttestation_email_expiresAt_idx" ON "AdultAttestation"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "StudentProfile_userId_createdAt_idx" ON "StudentProfile"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StudentProfile_status_createdAt_idx" ON "StudentProfile"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DirectNotice_studentProfileId_presentedAt_idx" ON "DirectNotice"("studentProfileId", "presentedAt");

-- CreateIndex
CREATE INDEX "DirectNotice_sentAt_idx" ON "DirectNotice"("sentAt");

-- CreateIndex
CREATE INDEX "ParentalConsent_studentProfileId_submittedAt_idx" ON "ParentalConsent"("studentProfileId", "submittedAt");

-- CreateIndex
CREATE INDEX "ParentalConsent_verifiedAt_idx" ON "ParentalConsent"("verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentVerificationChallenge_parentalConsentId_key" ON "ConsentVerificationChallenge"("parentalConsentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentVerificationChallenge_tokenHash_key" ON "ConsentVerificationChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "ConsentVerificationChallenge_expiresAt_idx" ON "ConsentVerificationChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "UploadTokenGrant_studentProfileId_createdAt_idx" ON "UploadTokenGrant"("studentProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_pathname_key" ON "Upload"("pathname");

-- CreateIndex
CREATE INDEX "Upload_studentProfileId_createdAt_idx" ON "Upload"("studentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Upload_status_createdAt_idx" ON "Upload"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Upload_status_extractedAt_idx" ON "Upload"("status", "extractedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_uploadId_key" ON "Extraction"("uploadId");

-- CreateIndex
CREATE INDEX "Extraction_status_startedAt_idx" ON "Extraction"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ExtractedProblem_extractionId_idx" ON "ExtractedProblem"("extractionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedProblem_extractionId_ordinal_key" ON "ExtractedProblem"("extractionId", "ordinal");

-- CreateIndex
CREATE INDEX "DeletionAudit_subjectRef_idx" ON "DeletionAudit"("subjectRef");

-- CreateIndex
CREATE INDEX "DeletionAudit_kind_completedAt_idx" ON "DeletionAudit"("kind", "completedAt");

-- CreateIndex
CREATE INDEX "ConsentAuditArtifact_purgeAfter_idx" ON "ConsentAuditArtifact"("purgeAfter");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectNotice" ADD CONSTRAINT "DirectNotice_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectNotice" ADD CONSTRAINT "DirectNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentalConsent" ADD CONSTRAINT "ParentalConsent_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentalConsent" ADD CONSTRAINT "ParentalConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentalConsent" ADD CONSTRAINT "ParentalConsent_directNoticeId_fkey" FOREIGN KEY ("directNoticeId") REFERENCES "DirectNotice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentVerificationChallenge" ADD CONSTRAINT "ConsentVerificationChallenge_parentalConsentId_fkey" FOREIGN KEY ("parentalConsentId") REFERENCES "ParentalConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadTokenGrant" ADD CONSTRAINT "UploadTokenGrant_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedProblem" ADD CONSTRAINT "ExtractedProblem_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
