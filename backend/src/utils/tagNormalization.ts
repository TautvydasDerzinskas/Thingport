/** Canonical casing for a single tag: first character uppercased, every other character
 * lowercased ("SKADIS" / "skadis" / "SkAdIs" -> "Skadis"). Empty/whitespace-only input returns
 * "" so callers can filter it out alongside their own blank-tag handling. */
export function normalizeTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Normalizes every tag in the list and drops duplicates that only differed by casing --
 * normalizeTag already maps every casing variant of a tag to the same exact string, so a
 * duplicate here is always an exact match, not just a case-insensitive one. Keeps first-seen
 * order. Use this at every point tags are written (print/category/collection tags, bookmarked
 * tags) so no two case variants of the same tag ever end up stored side by side again. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const normalized = normalizeTag(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
