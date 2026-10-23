-- Looks up a stored plate with the same content, so an identical file is shared instead of stored again.
CREATE INDEX "Plate_contentSha256_idx" ON "Plate"("contentSha256");
