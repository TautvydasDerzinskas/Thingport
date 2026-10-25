-- Supporting files and images are shared between users like plate files are (services/storedContent.ts): their content
-- hash is recorded when they're stored and indexed, so an identical new file finds a stored copy to clone.

-- AlterTable
ALTER TABLE "PrintFile" ADD COLUMN     "contentSha256" TEXT;

-- AlterTable
ALTER TABLE "PreviewImage" ADD COLUMN     "contentSha256" TEXT,
ADD COLUMN     "size" INTEGER;

-- AlterTable
ALTER TABLE "DescriptionImage" ADD COLUMN     "contentSha256" TEXT;

-- CreateIndex
CREATE INDEX "PrintFile_contentSha256_idx" ON "PrintFile"("contentSha256");

-- CreateIndex
CREATE INDEX "PreviewImage_contentSha256_idx" ON "PreviewImage"("contentSha256");

-- CreateIndex
CREATE INDEX "DescriptionImage_contentSha256_idx" ON "DescriptionImage"("contentSha256");
