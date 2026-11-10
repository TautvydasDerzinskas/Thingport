-- A model's licence, what it allows, and when it was read; and the LICENSE.txt written beside its files.
ALTER TABLE "Print" ADD COLUMN "license" JSONB;
ALTER TABLE "Print" ADD COLUMN "licenseAllows" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Print" ADD COLUMN "licenseReadAt" TIMESTAMP(3);
ALTER TYPE "PrintFileRole" ADD VALUE 'LICENSE';
