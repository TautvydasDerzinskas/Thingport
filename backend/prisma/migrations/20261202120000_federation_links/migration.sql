-- AlterTable
ALTER TABLE "Peer" ADD COLUMN "link" TEXT,
ADD COLUMN "linkToken" TEXT,
ADD COLUMN "linkSeenAt" TIMESTAMP(3),
ADD COLUMN "actorDocument" JSONB;

-- AlterTable
ALTER TABLE "PeerRequest" ADD COLUMN "linkToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Peer_linkToken_key" ON "Peer"("linkToken");

-- CreateIndex
CREATE UNIQUE INDEX "PeerRequest_linkToken_key" ON "PeerRequest"("linkToken");
