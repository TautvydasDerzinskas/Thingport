-- What a tool keeps that its other users may read (a print queue), and whom each user lets read theirs.

-- CreateTable
CREATE TABLE "ToolSharedData" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "size" INTEGER NOT NULL,
    "printId" TEXT,
    "originKey" TEXT,
    "sourceKey" TEXT,
    "info" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolSharedData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolAudience" (
    "toolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolAudience_pkey" PRIMARY KEY ("toolId","userId")
);

-- CreateIndex
CREATE INDEX "ToolSharedData_toolId_originKey_idx" ON "ToolSharedData"("toolId", "originKey");

-- CreateIndex
CREATE INDEX "ToolSharedData_toolId_sourceKey_idx" ON "ToolSharedData"("toolId", "sourceKey");

-- CreateIndex
CREATE INDEX "ToolSharedData_userId_idx" ON "ToolSharedData"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolSharedData_toolId_userId_key_key" ON "ToolSharedData"("toolId", "userId", "key");

-- CreateIndex
CREATE INDEX "ToolAudience_userId_idx" ON "ToolAudience"("userId");

-- AddForeignKey
ALTER TABLE "ToolSharedData" ADD CONSTRAINT "ToolSharedData_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSharedData" ADD CONSTRAINT "ToolSharedData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAudience" ADD CONSTRAINT "ToolAudience_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAudience" ADD CONSTRAINT "ToolAudience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

