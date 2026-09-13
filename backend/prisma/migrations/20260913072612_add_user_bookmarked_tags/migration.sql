-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bookmarkedTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
