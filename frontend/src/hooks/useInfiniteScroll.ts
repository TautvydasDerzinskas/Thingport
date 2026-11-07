import { useEffect, useRef } from "react";

/** Whether the sentinel is near the viewport now. One callback can carry several of its records, oldest first: a new
 *  observer's first "not near" arrives together with "near" when the page reaches the end straight after a load, and
 *  going by the first alone left the list stuck there, as nothing changes again at the bottom. */
export const nearNow = (entries: Pick<IntersectionObserverEntry, "isIntersecting">[]) =>
  entries[entries.length - 1]?.isIntersecting ?? false;

/** Fires `onLoadMore` when the sentinel nears the viewport, re-arming after every load. */
export function useInfiniteScroll(onLoadMore: () => void, hasMore: boolean, loading: boolean) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (nearNow(entries)) onLoadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loading]);

  return sentinelRef;
}
