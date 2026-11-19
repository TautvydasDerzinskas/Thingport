import { useSearchParams } from "react-router-dom";
import type { PrintSortMode } from "../api/prints";
import { defaultSortDirection, type SortDirection } from "../utils/sortDirection";

export const PRINT_SORT_MODES = ["newest", "popular", "downloads", "name"] as const;
export const SEARCH_SORT_MODES = ["relevance", ...PRINT_SORT_MODES] as const;

/** Keep the sort in the address alongside the filters and the remembered model grid. */
export function usePrintSort({ search = false, replace = false } = {}) {
  const [params, setParams] = useSearchParams();
  const modes: readonly PrintSortMode[] = search ? SEARCH_SORT_MODES : PRINT_SORT_MODES;
  const fallback = search ? "relevance" : "newest";
  const value = params.get("orderBy");
  const sortMode = modes.find((mode) => mode === value) ?? fallback;
  const order = params.get("orderDirection");
  const direction = order === "asc" || order === "desc" ? order : defaultSortDirection(sortMode);

  const setSort = (mode: PrintSortMode, nextDirection: SortDirection) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (mode === fallback) next.delete("orderBy");
        else next.set("orderBy", mode);
        if (nextDirection === defaultSortDirection(mode)) next.delete("orderDirection");
        else next.set("orderDirection", nextDirection);
        return next;
      },
      { replace },
    );
  };

  return {
    sortMode,
    direction,
    setSortMode: (mode: PrintSortMode) => {
      if (sortMode !== mode) setSort(mode, defaultSortDirection(mode));
    },
    setDirection: (next: SortDirection) => setSort(sortMode, next),
  };
}
