-- Achievements: what made a model (a tool or Studio), the badges users earned, the days they used Thingport, and a
-- partner's people's badges as their instance said.

-- AlterTable
ALTER TABLE "Print" ADD COLUMN "createdWith" TEXT,
ADD COLUMN "createdWithRef" TEXT;

-- AlterTable
ALTER TABLE "RemotePerson" ADD COLUMN "achievements" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badge" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActiveDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "UserActiveDay_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE INDEX "Print_userId_createdWith_createdWithRef_idx" ON "Print"("userId", "createdWith", "createdWithRef");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_badge_key" ON "UserAchievement"("userId", "badge");

-- CreateIndex
CREATE INDEX "UserActiveDay_day_idx" ON "UserActiveDay"("day");

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActiveDay" ADD CONSTRAINT "UserActiveDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
