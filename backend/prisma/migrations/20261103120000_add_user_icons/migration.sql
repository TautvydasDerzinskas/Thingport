-- CreateTable
CREATE TABLE "UserIcon" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIcon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserIcon_userId_idx" ON "UserIcon"("userId");

-- AddForeignKey
ALTER TABLE "UserIcon" ADD CONSTRAINT "UserIcon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
