-- Which of a partner's models a picture is of: the proxy serving it checks that on every picture it hasn't sent before.
-- CreateIndex
CREATE INDEX "RemoteModel_images_idx" ON "RemoteModel" USING GIN ("images");
