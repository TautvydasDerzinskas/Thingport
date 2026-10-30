-- Tools (services/toolsService.ts): installed from the repository for the instance, or made by a user; the data each
-- keeps per user; and the collections and models a tool brings with it.
ALTER TABLE "Collection" ADD COLUMN     "toolId" TEXT;
ALTER TABLE "Print" ADD COLUMN     "toolId" TEXT,
ADD COLUMN     "toolKey" TEXT;

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "userId" TEXT,
    "manifest" JSONB NOT NULL,
    "script" TEXT NOT NULL,
    "html" TEXT,
    "sha" TEXT NOT NULL,
    "modelsSha" TEXT,
    "modelsFailed" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolData" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "size" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tool_userId_idx" ON "Tool"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_scope_slug_key" ON "Tool"("scope", "slug");

-- CreateIndex
CREATE INDEX "ToolData_userId_idx" ON "ToolData"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolData_toolId_userId_key_key" ON "ToolData"("toolId", "userId", "key");

-- CreateIndex
CREATE INDEX "Collection_toolId_idx" ON "Collection"("toolId");

-- CreateIndex
CREATE INDEX "Print_toolId_idx" ON "Print"("toolId");

-- CreateIndex
CREATE UNIQUE INDEX "Print_userId_toolId_toolKey_key" ON "Print"("userId", "toolId", "toolKey");

-- AddForeignKey
ALTER TABLE "Print" ADD CONSTRAINT "Print_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolData" ADD CONSTRAINT "ToolData_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolData" ADD CONSTRAINT "ToolData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

