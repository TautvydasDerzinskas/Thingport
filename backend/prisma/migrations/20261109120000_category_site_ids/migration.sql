-- Each category's ids on the providers' sites in a table of their own, instead of a column apiece on "Category", so a
-- new provider needs no migration. The columns are copied, not moved: they stay one release, unread, so a downgrade
-- still finds them.

-- CreateTable
CREATE TABLE "CategorySiteId" (
    "categoryId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategorySiteId_pkey" PRIMARY KEY ("categoryId","provider","siteId")
);

-- CreateIndex
CREATE INDEX "CategorySiteId_provider_siteId_idx" ON "CategorySiteId"("provider", "siteId");

-- AddForeignKey
ALTER TABLE "CategorySiteId" ADD CONSTRAINT "CategorySiteId_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- In the order they were given; a repeated id keeps its first place.
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'makerworld', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."makerworldCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'thingiverse', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."thingiverseCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'printables', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."printablesCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'myminifactory', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."myminifactoryCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'snapmaker', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."snapmakerCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'makeronline', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."makeronlineCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'crealitycloud', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."crealitycloudCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'nexprint', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."nexprintCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'thangs', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."thangsCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;
INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
SELECT c."id", 'cults3d', s.id::text, (s.n - 1)::int FROM "Category" c, unnest(c."cults3dCatIds") WITH ORDINALITY AS s(id, n)
ON CONFLICT DO NOTHING;

-- The starter categories' ids are filled in at startup for a provider whose seed hasn't run yet
-- (services/categorySiteIds.ts). These providers' ran in the migrations that added them.
INSERT INTO "Setting" ("key", "value")
SELECT 'provider_category_seed:' || p, to_jsonb(CURRENT_TIMESTAMP::text)
FROM unnest(ARRAY['makerworld', 'thingiverse', 'printables', 'myminifactory', 'snapmaker', 'makeronline', 'crealitycloud', 'nexprint', 'thangs', 'cults3d']) AS p
ON CONFLICT DO NOTHING;
