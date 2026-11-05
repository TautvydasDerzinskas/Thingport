-- AlterTable
ALTER TABLE "Print" ADD COLUMN     "originalId" TEXT;

-- Each copy's first original, following copiedFromId back as far as it goes.
WITH RECURSIVE chain AS (
  SELECT id, "copiedFromId" AS parent, "copiedFromId" AS root, 1 AS depth
  FROM "Print"
  WHERE "copiedFromId" IS NOT NULL
  UNION ALL
  SELECT chain.id, parent."copiedFromId", parent."copiedFromId", chain.depth + 1
  FROM chain
  JOIN "Print" parent ON parent.id = chain.parent
  WHERE parent."copiedFromId" IS NOT NULL AND chain.depth < 1000
)
UPDATE "Print" SET "originalId" = deepest.root
FROM (SELECT DISTINCT ON (id) id, root FROM chain ORDER BY id, depth DESC) deepest
WHERE "Print".id = deepest.id;

-- One copy per user and original from here on. Where two were made before, the newer forgets its original.
UPDATE "Print" SET "originalId" = NULL
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId", "originalId" ORDER BY "createdAt", id) AS place
  FROM "Print"
  WHERE "originalId" IS NOT NULL
) ranked
WHERE "Print".id = ranked.id AND ranked.place > 1;

-- CreateIndex
CREATE UNIQUE INDEX "Print_userId_originalId_key" ON "Print"("userId", "originalId");
