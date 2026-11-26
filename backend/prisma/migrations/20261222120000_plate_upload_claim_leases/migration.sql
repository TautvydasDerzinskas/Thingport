ALTER TABLE "PlateUploadAttempt"
ADD COLUMN "claimToken" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
