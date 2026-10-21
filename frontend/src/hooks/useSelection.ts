import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Selection<T> = {
  /** Select mode: clicking an item selects it instead of opening it. */
  active: boolean;
  setActive: (active: boolean) => void;
  selected: T[];
  isSelected: (key: string) => boolean;
  /** `range` (a shift-click) also takes every item between this one and the last one clicked. */
  toggle: (key: string, range?: boolean) => void;
  selectAll: () => void;
  clear: () => void;
};

const everyItem = () => true;

/** Multi-select over a grid's loaded items, each known by `keyOf` (stable between renders). Items that leave the grid
 *  (deleted, filtered out) drop out of it, as do ones `selectable` turns down. */
export function useSelection<T>(
  items: T[],
  keyOf: (item: T) => string,
  selectable: (item: T) => boolean = everyItem,
): Selection<T> {
  const [active, setActiveState] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const pickable = useMemo(() => items.filter(selectable), [items, selectable]);

  useEffect(() => {
    setSelectedKeys((prev) => {
      if (!prev.size) return prev;
      const present = new Set(pickable.map(keyOf));
      const next = new Set([...prev].filter((key) => present.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [pickable, keyOf]);

  const clear = useCallback(() => {
    setSelectedKeys(new Set());
    anchorRef.current = null;
  }, []);

  const setActive = useCallback(
    (next: boolean) => {
      setActiveState(next);
      if (!next) clear();
    },
    [clear],
  );

  const toggle = useCallback(
    (key: string, range = false) => {
      const anchor = anchorRef.current;
      anchorRef.current = key;
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        const from = anchor ? pickable.findIndex((item) => keyOf(item) === anchor) : -1;
        const to = pickable.findIndex((item) => keyOf(item) === key);
        if (to < 0) return prev;
        if (range && anchor !== null && from >= 0) {
          // The range takes the state the anchor was left in, as a file manager does.
          const select = prev.has(anchor);
          for (const item of pickable.slice(Math.min(from, to), Math.max(from, to) + 1)) {
            if (select) next.add(keyOf(item));
            else next.delete(keyOf(item));
          }
        } else if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [pickable, keyOf],
  );

  const selectAll = useCallback(() => setSelectedKeys(new Set(pickable.map(keyOf))), [pickable, keyOf]);

  // Escape leaves select mode, unless it's closing a dialog or menu opened from it.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(".MuiModal-root, .MuiPopover-root")) return;
      setActive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, setActive]);

  const selected = useMemo(
    () => pickable.filter((item) => selectedKeys.has(keyOf(item))),
    [pickable, selectedKeys, keyOf],
  );
  const isSelected = useCallback((key: string) => selectedKeys.has(key), [selectedKeys]);

  return { active, setActive, selected, isSelected, toggle, selectAll, clear };
}
