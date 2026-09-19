import { prisma } from "../db";
import { printOutsByIds } from "./printLoader";
import type { PrintOut } from "../dto";

// ---- Global search (models primary, collections + tags secondary) ----------------------------
//
// Backed by Print.searchVector / Collection.searchVector -- generated tsvector columns with
// name/title weighted 'A', tags 'B', description/notes 'C', creator 'D' (see the migration that
// creates them, 20260919164610_add_search_vectors, and their own comments in schema.prisma).
// ts_rank naturally scores a name match above a description match because of that weighting, so
// there's no scoring formula to hand-roll here for prints/collections -- Postgres does it.
// "Tag" results have no vector of their own (a tag is just a string inside Print.tags, not a row
// -- see routes/tags.ts's own comment on this), so those are matched with a plain ILIKE over the
// distinct tag values instead, ranked exact-match-first, then prefix-match, then by how many
// models carry it.

const MODEL_RESULT_LIMIT = 6;
const COLLECTION_RESULT_LIMIT = 4;
const TAG_RESULT_LIMIT = 5;

export type SearchResult = {
  models: PrintOut[];
  collections: { id: string; name: string; item_count: number }[];
  tags: { tag: string; count: number }[];
};

const EMPTY_RESULT: SearchResult = { models: [], collections: [], tags: [] };

/** Turns free-typed search text into a tsquery string every token of which is a *prefix* match
 *  ("prin:* & yod:*") -- plain `websearch_to_tsquery` treats its input as a natural-language
 *  phrase and only ever matches whole tokens, which reads as broken in a type-ahead box (nothing
 *  matches until you finish typing a whole word). Each raw token is stripped down to letters/
 *  digits before being embedded in the query string -- to_tsquery's own syntax (`:`, `&`, `'`,
 *  parens, ...) would otherwise throw on stray punctuation instead of just ignoring it. Returns
 *  null for input with no usable tokens (blank, or punctuation-only) so callers can short-circuit
 *  without ever touching the database. */
function buildPrefixTsQuery(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean)
    .slice(0, 8); // defensive cap -- nothing legitimate needs more than a handful of words
  if (!tokens.length) return null;
  return tokens.map((token) => `${token}:*`).join(" & ");
}

/** Escapes %, _, and \ so a raw search term used inside ILIKE '%...%' is matched literally --
 *  otherwise a term containing e.g. "50%" would have that '%' act as an ILIKE wildcard instead of
 *  a literal character. Paired with `ILIKE ... ESCAPE '\'` at the call site. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function searchPrintIds(userId: string, tsQuery: string, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "Print"
    WHERE "userId" = ${userId} AND "searchVector" @@ to_tsquery('simple'::regconfig, ${tsQuery})
    ORDER BY ts_rank("searchVector", to_tsquery('simple'::regconfig, ${tsQuery})) DESC, "name" ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function searchCollections(
  userId: string,
  tsQuery: string,
  limit: number,
): Promise<{ id: string; name: string; item_count: number }[]> {
  const rows = await prisma.$queryRaw<{ id: string; name: string; item_count: bigint }[]>`
    SELECT c."id", c."name", count(ci."id")::bigint AS item_count
    FROM "Collection" c
    LEFT JOIN "CollectionItem" ci ON ci."collectionId" = c."id"
    WHERE c."userId" = ${userId} AND c."searchVector" @@ to_tsquery('simple'::regconfig, ${tsQuery})
    GROUP BY c."id", c."name", c."searchVector"
    ORDER BY ts_rank(c."searchVector", to_tsquery('simple'::regconfig, ${tsQuery})) DESC, c."name" ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ id: r.id, name: r.name, item_count: Number(r.item_count) }));
}

async function searchTags(userId: string, rawQuery: string, limit: number): Promise<{ tag: string; count: number }[]> {
  const likePattern = `%${escapeLikeTerm(rawQuery)}%`;
  const rows = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT tag, count(*)::bigint AS count
    FROM "Print" p, unnest(p."tags") AS tag
    WHERE p."userId" = ${userId} AND tag ILIKE ${likePattern} ESCAPE '\'
    GROUP BY tag
    ORDER BY
      (lower(tag) = lower(${rawQuery})) DESC,
      (lower(tag) LIKE lower(${rawQuery}) || '%') DESC,
      count DESC,
      tag ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

/** The global search box's one query: models (primary -- full PrintOut, same shape ModelCard
 *  already renders elsewhere, via printOutsByIds), plus collections and tags carrying a lighter
 *  {id/name/count} shape of their own (no cover photos -- this is a compact dropdown, not a
 *  grid). All three run in parallel; each is independently capped and pre-sorted, so the caller
 *  can render them as-is. */
export async function search(userId: string, rawQuery: string): Promise<SearchResult> {
  const tsQuery = buildPrefixTsQuery(rawQuery);
  if (!tsQuery) return EMPTY_RESULT;

  const [modelIds, collections, tags] = await Promise.all([
    searchPrintIds(userId, tsQuery, MODEL_RESULT_LIMIT),
    searchCollections(userId, tsQuery, COLLECTION_RESULT_LIMIT),
    searchTags(userId, rawQuery.trim(), TAG_RESULT_LIMIT),
  ]);

  const printOuts = await printOutsByIds(userId, modelIds);
  // printOutsByIds returns a Map keyed by id with no guaranteed order -- re-apply the rank order
  // searchPrintIds already computed, dropping any id it couldn't resolve to a full PrintOut
  // (shouldn't normally happen; printOutsByIds only omits ids it can't find at all).
  const models = modelIds.map((id) => printOuts.get(id)).filter((p): p is PrintOut => Boolean(p));

  return { models, collections, tags };
}
