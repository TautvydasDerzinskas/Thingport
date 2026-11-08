import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { useScrollRestoreHold } from "./useScrollRestoreHold";

type Kept<T, X> = { address: string; items: T[]; hasMore: boolean; alongside: X | undefined };

// The lists left most recently, by the history entry that showed them. Only back or forward reaches an entry again,
// and only a few steps back are likely, so the oldest go once there are more than this. Kept in memory: a reload
// starts afresh.
const KEEP = 6;
const kept = new Map<string, Kept<unknown, unknown>>();

type Options<X> = {
  /** What `loading` starts as when there's no list to put back. */
  loadingAtFirst?: boolean;
  /** Anything the list depends on that isn't in the address, which holds the filters and sort. */
  extra?: string;
  /** What the page shows beside the grid and loads with it (an author, a collection), kept and put back with it:
   *  `restored` on the way back, for the page's own state to start from. Read once the page has rendered. */
  alongside?: () => X;
};

/** A grid of models loaded a page at a time, kept for the history entry showing it: back or forward to that entry
 *  puts the same models back at once, so ScrollReset can return to where the reader was, rather than starting again
 *  from the first page. It owns the grid's `items`, `hasMore` and `loading`, which starts false when the list came back.
 *
 *  The page's load effect calls `returning()` once in each run that loads (one with nothing to load, like a search
 *  with no words, needn't): on back or forward to a kept list, it's put on screen and the count it holds comes back,
 *  for a quiet reload of that many (`keepLoaded`), which catches models edited or removed since. A filter the page
 *  keeps outside the address goes in `extra`, or changing it would count as the same list. */
export function useRememberedList<T, X = undefined>({
  loadingAtFirst = false,
  extra = "",
  alongside,
}: Options<X> = {}) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const { key } = location;
  const address = location.pathname + location.search + extra;

  const find = (): Kept<T, X> | null => {
    if (navigationType !== "POP") return null;
    const list = kept.get(key);
    return list && list.address === address ? (list as Kept<T, X>) : null;
  };
  const [mountedWith] = useState(find);
  const [items, setItems] = useState<T[]>(() => mountedWith?.items ?? []);
  const [hasMore, setHasMore] = useState(() => mountedWith?.hasMore ?? false);
  const [loading, setLoading] = useState(() => !mountedWith && loadingAtFirst);
  // A list no longer kept loads again on the way back: ScrollReset waits for it, however slow, rather than give up.
  useScrollRestoreHold(loading);
  // The entry whose kept list is on screen, so a later run of the load effect doesn't put it back over newer pages.
  const shownFor = useRef<string | null>(mountedWith ? key : null);

  // The grid as last shown, kept when the reader leaves its entry: by then the render in hand may already belong to
  // the next one.
  const shown = useRef<Kept<T, X> & { key: string; loading: boolean }>({
    key,
    address,
    items,
    hasMore,
    loading,
    alongside: undefined,
  });
  useLayoutEffect(() => {
    shown.current = { key, address, items, hasMore, loading, alongside: alongside?.() };
  });
  useLayoutEffect(() => {
    const entry = key;
    return () => {
      // Whatever's on screen now belongs to the entry being left: back to one shown before puts its own list back.
      shownFor.current = null;
      const { key: showing, loading: halfLoaded, ...list } = shown.current;
      // Another entry's: what was kept of this one stays.
      if (showing !== entry) return;
      kept.delete(entry);
      // Half loaded, or empty (its models gone, say): nothing worth putting back, nor what it showed before.
      if (halfLoaded || !list.items.length) return;
      kept.set(entry, list);
      while (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
    };
  }, [key]);

  /** Null unless this is back or forward to an entry whose list was kept; then how many models it holds. */
  const returning = (): number | null => {
    const list = find();
    if (!list) return null;
    if (shownFor.current === key) return Math.max(list.items.length, shown.current.items.length);
    shownFor.current = key;
    setItems(list.items);
    setHasMore(list.hasMore);
    setLoading(false);
    return list.items.length;
  };

  return { items, setItems, hasMore, setHasMore, loading, setLoading, returning, restored: mountedWith?.alongside };
}
