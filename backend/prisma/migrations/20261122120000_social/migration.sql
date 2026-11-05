-- AlterTable
ALTER TABLE "Print" ADD COLUMN     "copiedFromId" TEXT;

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Print_copiedFromId_idx" ON "Print"("copiedFromId");

-- CreateIndex
CREATE INDEX "Collection_isPublic_idx" ON "Collection"("isPublic");

-- AddForeignKey
ALTER TABLE "Print" ADD CONSTRAINT "Print_copiedFromId_fkey" FOREIGN KEY ("copiedFromId") REFERENCES "Print"("id") ON DELETE SET NULL ON UPDATE CASCADE;

