export type SortDirection = "asc" | "desc";

export function defaultSortDirection(mode: string): SortDirection {
  return mode === "name" || mode === "author" ? "asc" : "desc";
}
