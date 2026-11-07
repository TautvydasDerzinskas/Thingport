-- Connected instances, phase 4: where a copy of a partner's model came from.

-- AlterTable
ALTER TABLE "Print" ADD COLUMN "remoteSource" JSONB;
