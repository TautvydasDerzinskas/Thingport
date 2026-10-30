import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type PrintSource, printsApi } from "../api/prints";

export type ModelFilters = ReturnType<typeof useModelFilters>;

/** The filters behind a model list's filter button, in the URL so a narrowed list can be linked to and comes back
 *  on reload, as the sort order does. */
export function useModelFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Only the models that came with the script they were generated from -- "Generative models" in the filters.
  const generative = searchParams.get("generative") === "1";
  const setGenerative = useCallback(
    (on: boolean) =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (on) next.set("generative", "1");
        else next.delete("generative");
        return next;
      }),
    [setSearchParams],
  );

  // The sites turned off. What to hide rather than what to show, so a site the library gains later is listed from
  // the start rather than arriving already filtered out.
  const hiddenParam = searchParams.get("hideProviders") ?? "";
  const hiddenProviders = useMemo(() => hiddenParam.split(",").filter(Boolean), [hiddenParam]);
  const setHiddenProviders = useCallback(
    (next: string[]) =>
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next.length) params.set("hideProviders", next.join(","));
        else params.delete("hideProviders");
        return params;
      }),
    [setSearchParams],
  );

  const clear = useCallback(
    () =>
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.delete("generative");
        params.delete("hideProviders");
        return params;
      }),
    [setSearchParams],
  );

  return {
    generative,
    setGenerative,
    hiddenProviders,
    setHiddenProviders,
    clear,
    /** How many of the filters are narrowing the list, for the button's badge. */
    active: (generative ? 1 : 0) + (hiddenProviders.length ? 1 : 0),
  };
}

/** The sites the library holds models from, most first, for the filters' list of sites. Fetched again whenever
 *  `refreshKey` changes. */
export function useLibrarySources(refreshKey: unknown, onError?: (err: unknown) => void) {
  const [sources, setSources] = useState<PrintSource[]>([]);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    // An answer belonging to an older library is dropped rather than written over the newer list of sites:
    // two requests a refresh apart can land out of order.
    let current = true;
    (async () => {
      try {
        const next = await printsApi.sources();
        if (current) setSources(next);
      } catch (err) {
        // The filter falls back to listing no sites; the list itself is unaffected.
        if (current) onErrorRef.current?.(err);
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey only says when to fetch again
  }, [refreshKey]);

  return sources;
}
