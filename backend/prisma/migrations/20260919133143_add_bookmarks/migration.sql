-- CreateEnum
CREATE TYPE "BookmarkType" AS ENUM ('TAG', 'COLLECTION');

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BookmarkType" NOT NULL,
    "tag" TEXT,
    "collectionId" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bookmark_userId_order_idx" ON "Bookmark"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_type_tag_key" ON "Bookmark"("userId", "type", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_collectionId_key" ON "Bookmark"("userId", "collectionId");

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: carry every existing User.bookmarkedTags entry over into a Bookmark row (type
-- TAG) before that column is dropped below, one Bookmark per (user, tag) pair. `order` is seeded
-- alphabetically per user (row_number over the tag, 0-based) since that's exactly how the old
-- bookmarkedTags-backed sidebar/list already sorted them (see routes/tags.ts's old
-- sortedBookmarks) -- so this backfill is a no-op for anyone who hasn't dragged anything yet. The
-- id is just a random-enough unique string (this table has no other rows yet, so collisions are
-- effectively impossible); it doesn't need to be a real cuid.
--
-- WHERE + ON CONFLICT guard against data the app itself was never meant to produce but can't
-- fully rule out on a real production array that's been read-modify-written outside a
-- transaction since whenever it was first introduced: a stray NULL element (arrays can hold one
-- even though the app only ever pushes real strings), or the same tag appearing twice (the old
-- POST /tags/:tag/bookmark read-then-wrote the array with no row lock, so two near-simultaneous
-- bookmark clicks on the same tag could in principle both pass its own "already includes" check
-- before either write lands). Either would violate the new (userId, type, tag) unique index and
-- abort this whole migration without them -- there's nothing to recover by treating that as a
-- hard failure, so this just keeps one row and moves on.
INSERT INTO "Bookmark" ("id", "userId", "type", "tag", "order", "createdAt")
SELECT
    substr(md5(random()::text || clock_timestamp()::text || u."id" || t.tag), 1, 24),
    u."id",
    'TAG',
    t.tag,
    (row_number() OVER (PARTITION BY u."id" ORDER BY t.tag) - 1)::int,
    now()
FROM "User" u
CROSS JOIN LATERAL unnest(u."bookmarkedTags") AS t(tag)
WHERE t.tag IS NOT NULL
ON CONFLICT ("userId", "type", "tag") DO NOTHING;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "bookmarkedTags";
