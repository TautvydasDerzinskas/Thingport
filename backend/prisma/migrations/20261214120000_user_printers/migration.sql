-- The printers a user prints on (Configuration > Printers), the one each slicer's adapted copies are made for, the
-- slicers that open files as they are, and the printer suggestions they turned down.
CREATE TABLE "UserPrinter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "nozzle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPrinter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPrinter_userId_printerId_key" ON "UserPrinter"("userId", "printerId");

ALTER TABLE "UserPrinter" ADD CONSTRAINT "UserPrinter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "slicerPrinters" JSONB;
ALTER TABLE "User" ADD COLUMN "unadaptedSlicers" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "declinedPrinters" TEXT[] DEFAULT ARRAY[]::TEXT[];
