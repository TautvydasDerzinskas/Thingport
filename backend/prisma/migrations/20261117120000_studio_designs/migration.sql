-- Studio's designs, and each one's revisions for undo and redo. Nothing existing changes.
CREATE TABLE "StudioDesign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioDesign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioRevision" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "command" TEXT,
    "args" JSONB,
    "summary" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudioDesign_userId_updatedAt_idx" ON "StudioDesign"("userId", "updatedAt");
CREATE UNIQUE INDEX "StudioRevision_designId_position_key" ON "StudioRevision"("designId", "position");

ALTER TABLE "StudioDesign" ADD CONSTRAINT "StudioDesign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioRevision" ADD CONSTRAINT "StudioRevision_designId_fkey" FOREIGN KEY ("designId") REFERENCES "StudioDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
