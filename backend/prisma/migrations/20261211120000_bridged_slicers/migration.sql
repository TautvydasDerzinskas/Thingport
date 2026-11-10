-- The slicers with a link handler of their own that a user opens through Thingport Bridge instead.
ALTER TABLE "User" ADD COLUMN "bridgedSlicers" TEXT[] DEFAULT ARRAY[]::TEXT[];
