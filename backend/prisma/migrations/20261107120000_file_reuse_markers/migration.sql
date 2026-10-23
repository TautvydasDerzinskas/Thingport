-- The file reuse backfill (services/fileReuseBackfill.ts) records which inode and ctime a file had when it was made to
-- share its bytes with an identical one, so running it again leaves such files alone instead of replacing them anew.

-- AlterTable
ALTER TABLE "Plate" ADD COLUMN     "reuseCtimeNs" BIGINT,
ADD COLUMN     "reuseIno" BIGINT;

-- AlterTable
ALTER TABLE "PrintFile" ADD COLUMN     "reuseCtimeNs" BIGINT,
ADD COLUMN     "reuseIno" BIGINT;

-- AlterTable
ALTER TABLE "PreviewImage" ADD COLUMN     "reuseCtimeNs" BIGINT,
ADD COLUMN     "reuseIno" BIGINT;

-- AlterTable
ALTER TABLE "DescriptionImage" ADD COLUMN     "reuseCtimeNs" BIGINT,
ADD COLUMN     "reuseIno" BIGINT;
