-- Which of a partner's models a picture is of: the proxy serving it checks that on every picture it hasn't sent before.
-- CreateIndex
CREATE INDEX "RemoteModel_images_idx" ON "RemoteModel" USING GIN ("images");

-- When what's kept of a partner's collection was asked of it: the later of two reads is kept.
-- AlterTable
ALTER TABLE "RemoteCollection" ADD COLUMN "fetchedAt" TIMESTAMP(3);
