-- How the user arranged their Tools page: which layout, which order, and any tool they moved to a shelf of their
-- own choosing. Null until they change something, which is every user until they do, so nothing needs backfilling.
ALTER TABLE "User" ADD COLUMN "toolsView" JSONB;
