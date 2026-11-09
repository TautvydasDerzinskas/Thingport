-- A partner's collection shared with some of this instance's people, and the models known only from one.
-- AlterTable
ALTER TABLE "RemoteCollection" ADD COLUMN     "limited" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RemoteModel" ADD COLUMN     "limited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RemoteCollectionViewer" (
    "collectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteCollectionViewer_pkey" PRIMARY KEY ("collectionId","userId")
);

-- CreateIndex
CREATE INDEX "RemoteCollectionViewer_userId_idx" ON "RemoteCollectionViewer"("userId");

-- AddForeignKey
ALTER TABLE "RemoteCollectionViewer" ADD CONSTRAINT "RemoteCollectionViewer_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "RemoteCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteCollectionViewer" ADD CONSTRAINT "RemoteCollectionViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
