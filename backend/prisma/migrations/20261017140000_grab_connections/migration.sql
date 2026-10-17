-- CreateTable
CREATE TABLE "GrabConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrabConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrabConnection_tokenHash_key" ON "GrabConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "GrabConnection_userId_idx" ON "GrabConnection"("userId");

-- AddForeignKey
ALTER TABLE "GrabConnection" ADD CONSTRAINT "GrabConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
