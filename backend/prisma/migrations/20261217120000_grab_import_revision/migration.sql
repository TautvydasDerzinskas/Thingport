-- Each queueing of a link waiting for Thingport Grab, so what Grab began on an earlier one leaves a newer one alone.
ALTER TABLE "GrabImport" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
