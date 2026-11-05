-- Imports that wait their turn. Nothing uses the new value here: PostgreSQL won't allow that before the transaction it was
-- added in commits. No row changes state: what's paused stays paused until someone starts it.
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
-- When it joined the line, which orders it (Start and Retry go to the back). Null on anything that never did.
ALTER TABLE "ImportJob" ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3);
-- When this run began, for "Started 12 min ago". Null until then.
ALTER TABLE "ImportJob" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ImportJob_status_queuedAt_idx" ON "ImportJob"("status", "queuedAt");
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "startGrabLinks" BOOLEAN NOT NULL DEFAULT false;
