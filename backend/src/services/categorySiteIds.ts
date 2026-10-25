// A category's ids on each provider's site (CategorySiteId), which imports from it land in the category by. The
// starter categories' come from each provider's categories.json, so a new provider needs no column or SQL.

import type { CategorySiteId, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { MANIFESTS, PROVIDER_IDS, type ProviderId } from "../providers/index.generated";
import { PROVIDERS } from "../providers/registry";

const log = createLogger("categories");

/** Each provider's ids, in the order given; providers with none are left out. */
export type SiteIds = Partial<Record<ProviderId, string[]>>;

/** What a category query includes for siteIdsOf. */
export const WITH_SITE_IDS = { siteIds: { orderBy: { position: "asc" } } } satisfies Prisma.CategoryInclude;

export function siteIdsOf(rows: readonly Pick<CategorySiteId, "provider" | "siteId">[]): SiteIds {
  const ids: SiteIds = {};
  for (const id of PROVIDER_IDS) {
    const own = rows.filter((row) => row.provider === id).map((row) => row.siteId);
    if (own.length) ids[id] = own;
  }
  return ids;
}

const rowsOf = (categoryId: string, ids: SiteIds): Prisma.CategorySiteIdCreateManyInput[] =>
  PROVIDER_IDS.flatMap((provider) =>
    [...new Set(ids[provider] ?? [])].map((siteId, position) => ({ categoryId, provider, siteId, position })),
  );

/** Replaces the categories' ids for `providers` with those in `ids` (one entry per category). */
export async function replaceSiteIds(
  db: Prisma.TransactionClient,
  entries: readonly { categoryId: string; ids: SiteIds }[],
  providers: readonly ProviderId[] = PROVIDER_IDS,
): Promise<void> {
  if (!entries.length || !providers.length) return;
  await db.categorySiteId.deleteMany({
    where: { categoryId: { in: entries.map((entry) => entry.categoryId) }, provider: { in: [...providers] } },
  });
  const rows = entries.flatMap(({ categoryId, ids }) =>
    rowsOf(categoryId, Object.fromEntries(providers.map((provider) => [provider, ids[provider]]))),
  );
  if (rows.length) await db.categorySiteId.createMany({ data: rows });
}

const pathKey = (path: readonly string[]) => path.map((name) => name.trim().toLowerCase()).join("/");

/** Each provider's ids for the starter categories, by path key. */
const STARTER: ReadonlyMap<string, SiteIds> = (() => {
  const byPath = new Map<string, SiteIds>();
  for (const provider of PROVIDER_IDS) {
    for (const [path, ids] of Object.entries(PROVIDERS[provider].starterCategories)) {
      const key = pathKey(path.split("/"));
      byPath.set(key, { ...byPath.get(key), [provider]: ids.map(String) });
    }
  }
  return byPath;
})();

/** The providers' ids for the starter category at `path` (its names from the top), in provider order. */
export function starterSiteIds(path: readonly string[]): SiteIds {
  const ids = STARTER.get(pathKey(path)) ?? {};
  return Object.fromEntries(PROVIDER_IDS.flatMap((id) => (ids[id] ? [[id, ids[id]]] : [])));
}

const seedKey = (provider: ProviderId) => `provider_category_seed:${provider}`;

/** Once per provider, at startup: gives the starter categories of users who signed up before the provider was added
 *  its ids. A category is found by its path of names from the top; one a user renamed, moved or deleted is skipped,
 *  and one that already has ids for it keeps them. In SQL, as it reads every user's tree. */
export async function seedProviderCategoryIds(): Promise<void> {
  const done = new Set(
    (
      await prisma.setting.findMany({
        where: { key: { startsWith: "provider_category_seed:" } },
        select: { key: true },
      })
    ).map((setting) => setting.key),
  );
  for (const provider of PROVIDER_IDS.filter((id) => !done.has(seedKey(id)))) {
    const starter = Object.entries(PROVIDERS[provider].starterCategories).flatMap(([path, ids]) =>
      ids.map((siteId, position) => ({ path: pathKey(path.split("/")), siteId: String(siteId), position })),
    );
    const added = await prisma.$transaction(
      async (tx) => {
        const count = await tx.$executeRaw`
        WITH RECURSIVE tree AS (
          SELECT id, lower(trim(name)) AS path FROM "Category" WHERE kind = 'category' AND "parentId" IS NULL
          UNION ALL
          SELECT c.id, t.path || '/' || lower(trim(c.name))
          FROM "Category" c JOIN tree t ON c."parentId" = t.id
          WHERE c.kind = 'category'
        ), starter AS (
          SELECT * FROM unnest(
            ${starter.map((row) => row.path)}::text[],
            ${starter.map((row) => row.siteId)}::text[],
            ${starter.map((row) => row.position)}::int[]
          ) AS s(path, site_id, position)
        )
        INSERT INTO "CategorySiteId" ("categoryId", "provider", "siteId", "position")
        SELECT t.id, ${provider}, s.site_id, s.position FROM tree t JOIN starter s ON s.path = t.path
        WHERE NOT EXISTS (
          SELECT 1 FROM "CategorySiteId" own WHERE own."categoryId" = t.id AND own.provider = ${provider}
        )
        ON CONFLICT DO NOTHING`;
        await tx.setting.create({ data: { key: seedKey(provider), value: new Date().toISOString() } });
        return count;
      },
      { timeout: 120_000 },
    );
    log.info("starter category ids seeded", { provider: MANIFESTS[provider].name, ids: added });
  }
}
