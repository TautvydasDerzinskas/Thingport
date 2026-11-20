export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export function parseSortDirection(raw: unknown): SortDirection | undefined {
  return raw === "asc" || raw === "desc" ? raw : undefined;
}
