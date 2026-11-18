-- A supporting or prepared file's row is made before its file is in storage, and is ready once it is: saved in the row,
-- so a list read while the save is under way leaves it out, and one read after it's done has it.
ALTER TABLE "PrintFile" ADD COLUMN "ready" BOOLEAN NOT NULL DEFAULT true;
-- A row an older version left at its placeholder is a save that never finished: not ready either.
UPDATE "PrintFile" SET "ready" = false WHERE "storagePath" = 'pending' OR "storagePath" LIKE 'pending:%';
