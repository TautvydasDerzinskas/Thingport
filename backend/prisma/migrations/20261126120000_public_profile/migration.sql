-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarStyle" JSONB,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "coverPositionY" INTEGER,
ADD COLUMN     "coverPreset" TEXT,
ADD COLUMN     "modelsPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "profileLinks" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The others went on seeing the picture of the first author a user linked as themselves: it stays their avatar.
UPDATE "User" u SET "avatarUrl" = first."avatarUrl"
FROM (
  SELECT DISTINCT ON (l."userId") l."userId", a."avatarUrl"
  FROM "AuthorLink" l
  JOIN "Author" a ON a.id = l."authorId"
  WHERE a."avatarUrl" IS NOT NULL
  ORDER BY l."userId", l."createdAt"
) first
WHERE u.id = first."userId";
