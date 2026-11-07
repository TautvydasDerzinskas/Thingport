import { useEffect, useRef } from "react";

/** Whether the sentinel came near the viewport. One callback can carry several of its records: a new observer's first
 *  "not near" arrives together with "near" when the page reaches the end straight after a load, and a reader scrolling
 *  past it (beside a tall category panel) sends "near" then "not near". Going by one record left the list stuck. */
export const cameNear = (entries: Pick<IntersectionObserverEntry, "isIntersecting">[]) =>
  entries.some((entry) => entry.isIntersecting);

/** Fires `onLoadMore` when the sentinel nears the viewport, re-arming after every load. */
export function useInfiniteScroll(onLoadMore: () => void, hasMore: boolean, loading: boolean) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    // An observer taken down mustn't ask for a page: its onLoadMore may belong to a list that's since changed.
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (live && cameNear(entries)) onLoadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [onLoadMore, hasMore, loading]);

  return sentinelRef;
}
