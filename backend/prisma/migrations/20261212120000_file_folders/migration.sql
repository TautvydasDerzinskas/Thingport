-- The folder a model's file came in, from its site, its zip or a partner instance. Null for every file before.
ALTER TABLE "Plate" ADD COLUMN "folder" TEXT;
ALTER TABLE "PrintFile" ADD COLUMN "folder" TEXT;
