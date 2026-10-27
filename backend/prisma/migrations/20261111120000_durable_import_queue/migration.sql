ALTER TYPE "ImportJobType" ADD VALUE 'SINGLE';
ALTER TYPE "ImportJobStatus" ADD VALUE 'QUEUED';
ALTER TABLE "ImportJob" ADD COLUMN "result" JSONB, ADD COLUMN "errorHttpStatus" INTEGER;
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob" ("status", "createdAt");
