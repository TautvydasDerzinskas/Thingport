/** Backfill: rewrites every existing Print/Category/Collection tags array (and every User's
 * bookmarked tags) to the canonical casing (normalizeTags) that every write path now enforces
 * going forward -- so tags that only ever differed by casing ("skadis" / "SKADIS") collapse into
 * one ("Skadis"). Safe to run more than once: normalizing already-normalized tags is a no-op per
 * row, so a row is only touched (and only counted as "updated") when something actually changes.
 */
import { prisma } from "../db";
import { normalizeTags } from "../utils/tagNormalization";

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

async function normalizePrints(): Promise<void> {
  const rows = await prisma.print.findMany({ select: { id: true, tags: true } });
  let updated = 0;
  for (const row of rows) {
    const next = normalizeTags(row.tags);
    if (sameTags(row.tags, next)) continue;
    await prisma.print.update({ where: { id: row.id }, data: { tags: next } });
    updated++;
  }
  console.log(`Print: ${updated} of ${rows.length} row(s) updated`);
}

async function normalizeCategories(): Promise<void> {
  const rows = await prisma.category.findMany({ select: { id: true, tags: true } });
  let updated = 0;
  for (const row of rows) {
    const next = normalizeTags(row.tags);
    if (sameTags(row.tags, next)) continue;
    await prisma.category.update({ where: { id: row.id }, data: { tags: next } });
    updated++;
  }
  console.log(`Category: ${updated} of ${rows.length} row(s) updated`);
}

async function normalizeCollections(): Promise<void> {
  const rows = await prisma.collection.findMany({ select: { id: true, tags: true } });
  let updated = 0;
  for (const row of rows) {
    const next = normalizeTags(row.tags);
    if (sameTags(row.tags, next)) continue;
    await prisma.collection.update({ where: { id: row.id }, data: { tags: next } });
    updated++;
  }
  console.log(`Collection: ${updated} of ${rows.length} row(s) updated`);
}

async function normalizeBookmarkedTags(): Promise<void> {
  const rows = await prisma.user.findMany({ select: { id: true, bookmarkedTags: true } });
  let updated = 0;
  for (const row of rows) {
    const next = normalizeTags(row.bookmarkedTags);
    if (sameTags(row.bookmarkedTags, next)) continue;
    await prisma.user.update({ where: { id: row.id }, data: { bookmarkedTags: next } });
    updated++;
  }
  console.log(`User.bookmarkedTags: ${updated} of ${rows.length} row(s) updated`);
}

/** Runs the full backfill unconditionally. Used by the standalone `tags:normalize-casing` script
 * and by server.ts's startup call (see the TEMPORARY note there -- there's no "only once" guard
 * here, so remove that call once this has run against prod after the next deploy). */
export async function normalizeAllTagCasing(): Promise<void> {
  await normalizePrints();
  await normalizeCategories();
  await normalizeCollections();
  await normalizeBookmarkedTags();
}
