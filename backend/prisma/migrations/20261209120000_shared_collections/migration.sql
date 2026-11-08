-- CreateEnum
CREATE TYPE "CollectionVisibility" AS ENUM ('PRIVATE', 'SHARED', 'PUBLIC');

-- AlterTable: a collection that was public stays public.
ALTER TABLE "Collection" ADD COLUMN     "visibility" "CollectionVisibility" NOT NULL DEFAULT 'PRIVATE';
UPDATE "Collection" SET "visibility" = 'PUBLIC' WHERE "isPublic";

-- DropIndex
DROP INDEX "Collection_isPublic_idx";

-- AlterTable
ALTER TABLE "Collection" DROP COLUMN "isPublic";

-- CreateIndex
CREATE INDEX "Collection_visibility_idx" ON "Collection"("visibility");

-- CreateTable
CREATE TABLE "CollectionShare" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT,
    "remotePersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionShare_pkey" PRIMARY KEY ("id"),
    -- Someone here or someone on a partner instance, never both or neither.
    CONSTRAINT "CollectionShare_one_person" CHECK (("userId" IS NULL) <> ("remotePersonId" IS NULL))
);

-- CreateIndex
CREATE INDEX "CollectionShare_userId_idx" ON "CollectionShare"("userId");

-- CreateIndex
CREATE INDEX "CollectionShare_remotePersonId_idx" ON "CollectionShare"("remotePersonId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionShare_collectionId_userId_key" ON "CollectionShare"("collectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionShare_collectionId_remotePersonId_key" ON "CollectionShare"("collectionId", "remotePersonId");

-- AddForeignKey
ALTER TABLE "CollectionShare" ADD CONSTRAINT "CollectionShare_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionShare" ADD CONSTRAINT "CollectionShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionShare" ADD CONSTRAINT "CollectionShare_remotePersonId_fkey" FOREIGN KEY ("remotePersonId") REFERENCES "RemotePerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
