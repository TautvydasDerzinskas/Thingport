-- CreateTable
CREATE TABLE "StudioMessage" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "steps" JSONB,
    "outcome" TEXT,
    "error" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioMessage_designId_createdAt_idx" ON "StudioMessage"("designId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudioMessage" ADD CONSTRAINT "StudioMessage_designId_fkey" FOREIGN KEY ("designId") REFERENCES "StudioDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
