import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// How long a page reached by back or forward gets to load enough to scroll back to where it was left.
const RESTORE_FOR_MS = 3000;
// Any of these means the reader has started scrolling for themselves.
const READER_INPUT = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/** Scrolls to `top` now and again each time the page grows, until it gets there, the reader scrolls, or time's up. */
function scrollBackTo(top: number): () => void {
  const reached = () => {
    window.scrollTo(0, top);
    return Math.abs(window.scrollY - top) < 2;
  };
  if (reached()) return () => {};
  const growing = new ResizeObserver(() => {
    if (reached()) stop();
  });
  const timer = window.setTimeout(() => stop(), RESTORE_FOR_MS);
  function stop() {
    growing.disconnect();
    window.clearTimeout(timer);
    for (const type of READER_INPUT) window.removeEventListener(type, stop);
  }
  growing.observe(document.body);
  for (const type of READER_INPUT) window.addEventListener(type, stop, { passive: true });
  return stop;
}

/** BrowserRouter leaves the window where it was, so a new page opened as far down as the last one was scrolled.
 *  Only a new path resets: a query change (filters, sorting, an open dialog) stays put. Back and forward return to
 *  where that page was left: the browser tries as well, but while the page is still loading it's too short to get
 *  there, so the place is kept here and scrolled back to once the page has grown. Reloads are left to the browser. */
export default function ScrollReset() {
  const { key, pathname } = useLocation();
  const navigationType = useNavigationType();
  const lastPathname = useRef(pathname);
  // Each history entry's place, by its key.
  const places = useRef(new Map<string, number>());
  const currentKey = useRef(key);
  // From back or forward until the page it goes to is shown: the browser's own restoring scrolls the old page then,
  // which isn't a place to keep for either.
  const traversing = useRef(false);

  useEffect(() => {
    const keep = () => {
      if (!traversing.current) places.current.set(currentKey.current, window.scrollY);
    };
    const startTraversal = () => {
      traversing.current = true;
    };
    window.addEventListener("scroll", keep, { passive: true });
    window.addEventListener("popstate", startTraversal);
    return () => {
      window.removeEventListener("scroll", keep);
      window.removeEventListener("popstate", startTraversal);
    };
  }, []);

  useLayoutEffect(() => {
    currentKey.current = key;
    traversing.current = false;
    const newPage = lastPathname.current !== pathname;
    lastPathname.current = pathname;
    if (newPage && navigationType === "POP") return scrollBackTo(places.current.get(key) ?? 0);
    if (newPage) window.scrollTo(0, 0);
    // Kept now too, as an entry that's never scrolled (a query change, a page that fits the window) has no scroll event.
    places.current.set(key, window.scrollY);
  }, [key, pathname, navigationType]);

  return null;
}
