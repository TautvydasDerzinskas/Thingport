-- Dashboard v3: templates, custom widgets, uploaded icons.

-- The dashboard's templates and which one shows.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dashboardTemplates" JSONB;

-- Set once the sample custom widgets were installed for the user.
ALTER TABLE "User" ADD COLUMN     "sampleWidgetsAdded" BOOLEAN NOT NULL DEFAULT false;

-- Dashboard widgets users make or install from the community repository.
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

-- Icons users upload for launcher links and custom widgets.
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
