-- A collection can follow several provider collections: one sync row each, no longer one per collection.
DROP INDEX "CollectionSync_collectionId_key";
CREATE INDEX "CollectionSync_collectionId_idx" ON "CollectionSync"("collectionId");

-- The provider collection's name, to tell a collection's sources apart.
ALTER TABLE "CollectionSync" ADD COLUMN "title" TEXT;
