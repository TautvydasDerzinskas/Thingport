-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "hostMembers" JSONB,
ADD COLUMN     "hostPeerId" TEXT,
ADD COLUMN     "remoteApId" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "apId" TEXT,
ADD COLUMN     "remoteSenderCard" JSONB,
ADD COLUMN     "remoteSenderId" TEXT;

-- AlterTable
ALTER TABLE "ChatAttachment" ADD COLUMN     "remoteModelApId" TEXT;

-- AlterTable
ALTER TABLE "RemotePerson" ADD COLUMN     "listed" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ChatRemoteMember" (
    "chatId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRemoteMember_pkey" PRIMARY KEY ("chatId","personId")
);

-- CreateIndex
CREATE INDEX "ChatRemoteMember_personId_idx" ON "ChatRemoteMember"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_remoteApId_key" ON "Chat"("remoteApId");

-- CreateIndex
CREATE INDEX "Chat_hostPeerId_idx" ON "Chat"("hostPeerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_apId_key" ON "ChatMessage"("apId");

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_hostPeerId_fkey" FOREIGN KEY ("hostPeerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRemoteMember" ADD CONSTRAINT "ChatRemoteMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRemoteMember" ADD CONSTRAINT "ChatRemoteMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "RemotePerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_remoteSenderId_fkey" FOREIGN KEY ("remoteSenderId") REFERENCES "RemotePerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

