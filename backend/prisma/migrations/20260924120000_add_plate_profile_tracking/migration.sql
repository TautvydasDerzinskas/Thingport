-- AlterTable
ALTER TABLE "Plate" ADD COLUMN     "sourceInstanceId" TEXT,
ADD COLUMN     "contentSha256" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Plate_printId_sourceInstanceId_key" ON "Plate"("printId", "sourceInstanceId");
