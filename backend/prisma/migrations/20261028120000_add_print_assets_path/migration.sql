-- AlterTable
ALTER TABLE "Print" ADD COLUMN "assetsPath" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Print_assetsPath_key" ON "Print"("assetsPath");
