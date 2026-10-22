-- CreateTable
CREATE TABLE "CustomWidget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "script" TEXT NOT NULL,
    "html" TEXT,
    "sha" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomWidget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomWidget_userId_idx" ON "CustomWidget"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomWidget_userId_source_slug_key" ON "CustomWidget"("userId", "source", "slug");

-- AddForeignKey
ALTER TABLE "CustomWidget" ADD CONSTRAINT "CustomWidget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
