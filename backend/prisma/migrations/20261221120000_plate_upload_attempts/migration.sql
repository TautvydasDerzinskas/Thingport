CREATE TABLE "PlateUploadAttempt" (
    "id" TEXT NOT NULL,
    "printId" TEXT NOT NULL,
    "clientUploadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "plateId" TEXT,

    CONSTRAINT "PlateUploadAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlateUploadAttempt_printId_clientUploadId_key"
ON "PlateUploadAttempt"("printId", "clientUploadId");

ALTER TABLE "PlateUploadAttempt"
ADD CONSTRAINT "PlateUploadAttempt_printId_fkey"
FOREIGN KEY ("printId") REFERENCES "Print"("id") ON DELETE CASCADE ON UPDATE CASCADE;
