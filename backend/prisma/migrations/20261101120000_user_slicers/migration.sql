-- The slicers a user has installed, offered in a model's "Open in" menu. "slicer" stays the one the
-- main button opens: the last one used. Existing users start with the one they had picked.
ALTER TABLE "User" ADD COLUMN "slicers" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "User" SET "slicers" = ARRAY["slicer"] WHERE "slicer" IS NOT NULL;
