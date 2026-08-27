-- CreateEnum
CREATE TYPE "PracticeSetKind" AS ENUM ('PRACTICE', 'CHECKPOINT');

-- AlterTable
ALTER TABLE "ExtractedProblem" ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "PracticeSet" ADD COLUMN     "kind" "PracticeSetKind" NOT NULL DEFAULT 'PRACTICE',
ALTER COLUMN "extractionId" DROP NOT NULL;

-- ── Hand-written below this line (ADR-0017). Prisma cannot express a CHECK
-- ── constraint in schema.prisma, so this half of the invariant is invisible
-- ── to a reader of that file. `tests/integration/practice-set-kind-constraint.test.ts`
-- ── is what proves it is real.
--
-- Dropping NOT NULL from "extractionId" above weakened M2 AC 3 — "practice
-- only ever comes from a CONFIRMED extraction" — from a schema guarantee into
-- something application code has to remember. This gives the guarantee back,
-- and gives back more than was there: it is now equally impossible to store a
-- CHECKPOINT that claims a worksheet.
ALTER TABLE "PracticeSet" ADD CONSTRAINT "practice_set_kind_source"
  CHECK (
    ("kind" = 'PRACTICE'   AND "extractionId" IS NOT NULL) OR
    ("kind" = 'CHECKPOINT' AND "extractionId" IS NULL)
  );

-- Serves the checkpoint eligibility query and the per-kind daily cap, both of
-- which filter by (studentProfileId, kind) and order by createdAt.
CREATE INDEX "PracticeSet_studentProfileId_kind_createdAt_idx"
  ON "PracticeSet" ("studentProfileId", "kind", "createdAt");
