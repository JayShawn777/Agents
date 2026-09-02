-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "ownerUserId" TEXT;

-- CreateIndex
CREATE INDEX "Persona_ownerUserId_idx" ON "Persona"("ownerUserId");

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

