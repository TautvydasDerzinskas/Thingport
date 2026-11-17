-- A part of a model's page is now drawn by its tool, which reads its own entries, so none carries what the page shows.
ALTER TABLE "ToolSharedData" DROP COLUMN "info";
