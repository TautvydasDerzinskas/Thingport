-- Connected instances, phase 3: what partners share, as read from their directories, for Explore here.

-- AlterTable
ALTER TABLE "Peer" ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RemotePerson" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "apId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "links" TEXT[],
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "coverPreset" TEXT,
    "coverPositionY" INTEGER NOT NULL DEFAULT 50,
    "modelCount" INTEGER NOT NULL DEFAULT 0,
    "collectionCount" INTEGER NOT NULL DEFAULT 0,
    "sharedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemotePerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteModel" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "apId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "images" TEXT[],
    "files" JSONB NOT NULL DEFAULT '[]',
    "sharedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteCollection" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "apId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "modelApIds" TEXT[],
    "updatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemotePerson_apId_key" ON "RemotePerson"("apId");

-- CreateIndex
CREATE INDEX "RemotePerson_peerId_idx" ON "RemotePerson"("peerId");

-- CreateIndex
CREATE INDEX "RemotePerson_sharedAt_idx" ON "RemotePerson"("sharedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteModel_apId_key" ON "RemoteModel"("apId");

-- CreateIndex
CREATE INDEX "RemoteModel_peerId_idx" ON "RemoteModel"("peerId");

-- CreateIndex
CREATE INDEX "RemoteModel_personId_idx" ON "RemoteModel"("personId");

-- CreateIndex
CREATE INDEX "RemoteModel_sharedAt_idx" ON "RemoteModel"("sharedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteCollection_apId_key" ON "RemoteCollection"("apId");

-- CreateIndex
CREATE INDEX "RemoteCollection_peerId_idx" ON "RemoteCollection"("peerId");

-- CreateIndex
CREATE INDEX "RemoteCollection_personId_idx" ON "RemoteCollection"("personId");

-- CreateIndex
CREATE INDEX "RemoteCollection_updatedAt_idx" ON "RemoteCollection"("updatedAt");

-- AddForeignKey
ALTER TABLE "RemotePerson" ADD CONSTRAINT "RemotePerson_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteModel" ADD CONSTRAINT "RemoteModel_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteModel" ADD CONSTRAINT "RemoteModel_personId_fkey" FOREIGN KEY ("personId") REFERENCES "RemotePerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteCollection" ADD CONSTRAINT "RemoteCollection_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteCollection" ADD CONSTRAINT "RemoteCollection_personId_fkey" FOREIGN KEY ("personId") REFERENCES "RemotePerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
