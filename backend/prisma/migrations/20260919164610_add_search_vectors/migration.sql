-- Global search: a generated tsvector column per searchable table, weighted so a name match
-- outranks a description/notes match, plus a GIN index on each -- see services/searchService.ts
-- and schema.prisma's Print.searchVector / Collection.searchVector comments. Neither the column
-- nor its index is declared in schema.prisma (both are `Unsupported` there), so this migration is
-- the only place either exists -- future schema changes to these tables won't touch it as long as
-- the generated columns themselves aren't dropped.
--
-- 'simple' text search config is used deliberately instead of 'english': model/collection names
-- and tags read more like short identifiers ("PLA+ Vase", "Baby Yoda") than prose, so English
-- stemming/stopword removal would only risk dropping or conflating tokens users actually typed --
-- predictable substring-ish matching (still with proper word-boundary tokenization and ranking)
-- fits this data better.

-- A GENERATED ALWAYS AS expression must be provably IMMUTABLE. Postgres's own array_to_string()
-- is only STABLE (conservatively, since it's polymorphic over anyarray), even though it's
-- perfectly deterministic for the concrete text[] case every caller below actually uses -- so
-- this is a thin IMMUTABLE wrapper purely to satisfy that check, not a behavior change. It has to
-- be a real, permanent function (not dropped after this migration): the generated columns below
-- call it on every future INSERT/UPDATE for as long as they exist.
CREATE OR REPLACE FUNCTION search_array_to_string(text[], text) RETURNS text AS $$
  SELECT array_to_string($1, $2);
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- CreateColumn (Print)
-- The explicit ::regconfig cast on 'simple' matters too: Postgres's GENERATED ALWAYS AS validator
-- rejects to_tsvector(text, text) here as "not immutable" (the implicit text->regconfig cast it
-- would otherwise perform involves a catalog lookup) -- casting the literal ourselves resolves it
-- at parse time instead, which the immutability check accepts.
ALTER TABLE "Print" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple'::regconfig, coalesce("name", '') || ' ' || coalesce("title", '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(search_array_to_string("tags", ' '), '')), 'B') ||
  setweight(to_tsvector('simple'::regconfig, coalesce("notes", '')), 'C') ||
  setweight(to_tsvector('simple'::regconfig, coalesce("creator", '')), 'D')
) STORED;

-- CreateIndex (Print)
CREATE INDEX "Print_searchVector_idx" ON "Print" USING GIN ("searchVector");

-- CreateColumn (Collection)
ALTER TABLE "Collection" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple'::regconfig, coalesce("name", '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(search_array_to_string("tags", ' '), '')), 'B') ||
  setweight(to_tsvector('simple'::regconfig, coalesce("description", '')), 'C')
) STORED;

-- CreateIndex (Collection)
CREATE INDEX "Collection_searchVector_idx" ON "Collection" USING GIN ("searchVector");
