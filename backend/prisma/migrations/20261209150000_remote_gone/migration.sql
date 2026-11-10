-- CreateTable
CREATE TABLE "RemoteGone" (
    "apId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteGone_pkey" PRIMARY KEY ("apId")
);

-- CreateIndex
CREATE INDEX "RemoteGone_peerId_idx" ON "RemoteGone"("peerId");

-- AddForeignKey
ALTER TABLE "RemoteGone" ADD CONSTRAINT "RemoteGone_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
