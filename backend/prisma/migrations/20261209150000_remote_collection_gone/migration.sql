-- CreateTable
CREATE TABLE "RemoteCollectionGone" (
    "apId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteCollectionGone_pkey" PRIMARY KEY ("apId")
);

-- CreateIndex
CREATE INDEX "RemoteCollectionGone_peerId_idx" ON "RemoteCollectionGone"("peerId");

-- AddForeignKey
ALTER TABLE "RemoteCollectionGone" ADD CONSTRAINT "RemoteCollectionGone_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
