-- CreateEnum
CREATE TYPE "PeerStatus" AS ENUM ('OUTGOING', 'ACTIVE', 'PAUSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PeerRequestKind" AS ENUM ('INCOMING', 'LOCAL');

-- CreateEnum
CREATE TYPE "PeerRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Peer" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "name" TEXT,
    "version" TEXT,
    "actorUrl" TEXT,
    "inboxUrl" TEXT,
    "publicKeys" JSONB,
    "fingerprint" TEXT,
    "status" "PeerStatus" NOT NULL,
    "followId" TEXT,
    "initiatedBy" TEXT NOT NULL DEFAULT 'us',
    "note" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Peer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeerRequest" (
    "id" TEXT NOT NULL,
    "kind" "PeerRequestKind" NOT NULL,
    "status" "PeerRequestStatus" NOT NULL DEFAULT 'PENDING',
    "origin" TEXT NOT NULL,
    "requesterName" TEXT,
    "requesterHandle" TEXT,
    "requesterUrl" TEXT,
    "targetHandle" TEXT,
    "note" TEXT,
    "activity" JSONB,
    "headers" JSONB,
    "url" TEXT,
    "userId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationDelivery" (
    "id" TEXT NOT NULL,
    "peerId" TEXT,
    "origin" TEXT NOT NULL,
    "inboxUrl" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "activity" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FederationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationKv" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FederationKv_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Peer_origin_key" ON "Peer"("origin");

-- CreateIndex
CREATE INDEX "Peer_status_idx" ON "Peer"("status");

-- CreateIndex
CREATE INDEX "PeerRequest_status_kind_idx" ON "PeerRequest"("status", "kind");

-- CreateIndex
CREATE INDEX "PeerRequest_origin_idx" ON "PeerRequest"("origin");

-- CreateIndex
CREATE INDEX "PeerRequest_userId_idx" ON "PeerRequest"("userId");

-- CreateIndex
CREATE INDEX "FederationDelivery_nextAttemptAt_idx" ON "FederationDelivery"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "FederationDelivery_peerId_idx" ON "FederationDelivery"("peerId");

-- CreateIndex
CREATE INDEX "FederationKv_expiresAt_idx" ON "FederationKv"("expiresAt");

-- AddForeignKey
ALTER TABLE "PeerRequest" ADD CONSTRAINT "PeerRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationDelivery" ADD CONSTRAINT "FederationDelivery_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
