-- Where each user sends a model's file from its page: printers, webhooks, links and requests (Configuration → Send to).

-- CreateTable
CREATE TABLE "SendTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "how" JSONB NOT NULL,
    "secrets" JSONB,
    "placement" TEXT NOT NULL DEFAULT 'menu',
    "fileTypes" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SendTarget_userId_position_idx" ON "SendTarget"("userId", "position");

-- AddForeignKey
ALTER TABLE "SendTarget" ADD CONSTRAINT "SendTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

