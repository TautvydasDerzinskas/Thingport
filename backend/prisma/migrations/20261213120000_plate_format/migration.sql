-- What kind of 3MF a plate is (src/adapter/format.ts), read when it is stored.
ALTER TABLE "Plate" ADD COLUMN "format" JSONB;
