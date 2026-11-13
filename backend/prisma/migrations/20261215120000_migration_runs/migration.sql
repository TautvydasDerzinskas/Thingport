-- Administration > Migrate: migrations into this instance from another one, with what each brought.
CREATE TABLE "MigrationRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "plan" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB,
    "report" JSONB,
    "error" JSONB,
    "stagingDb" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MigrationRun_createdAt_idx" ON "MigrationRun"("createdAt");
