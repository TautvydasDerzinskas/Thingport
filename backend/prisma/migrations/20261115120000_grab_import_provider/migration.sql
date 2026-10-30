-- GrabImport was MakerOnline's alone, so its rows said so only by their url. OwlCAD now waits in it too -- its CAD
-- projects have no stored mesh, and only its own editor can build one -- so each row names its provider. Existing
-- rows are MakerOnline's, which is what the default backfills them to.
ALTER TABLE "GrabImport" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'makeronline';

-- Grab asks for one provider's waiting imports at a time, on that provider's own pages.
CREATE INDEX "GrabImport_userId_provider_idx" ON "GrabImport"("userId", "provider");
