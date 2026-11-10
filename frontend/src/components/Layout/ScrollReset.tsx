import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { scrollRestoreHeld } from "../../hooks/useScrollRestoreHold";

// How long a page reached by back or forward may go without growing before its place is given up on. Counted from
// the last time it grew, as a page can fill in a step at a time. A grid still loading its list holds it open
// (useScrollRestoreHold), up to HELD_AT_MOST_MS; the reader scrolling ends it sooner.
const WAIT_FOR_GROWTH_MS = 8000;
// The longest a place is followed with nothing holding it open, for a page whose size never settles (something
// animating, say). Counted from when the last hold ended, so the pages after a slow first one still get there.
const RESTORE_AT_MOST_MS = 20000;
// The longest while a grid is still loading: a slow server's list gets there, one that never answers doesn't keep the
// restore going. With RESTORE_AT_MOST_MS after it, a restore lasts 80 s at most.
const HELD_AT_MOST_MS = 60000;
// Keys that scroll the page, outside a field being typed in. With the wheel and a moving touch, the reader scrolling for
// themselves; Tab or a click doesn't end a restore, and a drag of the scrollbar shows as the page moving.
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function scrollsThePage(event: KeyboardEvent): boolean {
  const target = event.target;
  const typing =
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  return !typing && SCROLL_KEYS.has(event.key);
}

type Place = { x: number; y: number };

// Each history entry's place, by entryOf. Outside the component, which signing out unmounts with the router: back to
// an entry from before still finds its place.
const places = new Map<string, Place>();

/** Which history entry this is. The router's key, except for entries without one, which all share "default": the
 *  page first opened, and in-page #anchors the browser added. Those go by their address, so each keeps its own place. */
function entryOf(key: string, address: { pathname: string; search: string; hash: string }): string {
  return key === "default" ? `default ${address.pathname}${address.search}${address.hash}` : key;
}

const here = (): Place => ({ x: window.scrollX, y: window.scrollY });

/** Scrolls to `place` now and again each time the page changes size, until it gets there, the reader scrolls, or the
 *  page stops growing; then calls `done`. The page's size is read each frame: html, body and #root are the window's size
 *  (index.css), so none of them changes size as the content does. */
function scrollBackTo(place: Place, done: () => void): () => void {
  let frame = 0;
  let size = "";
  let seen = here();
  const startedAt = performance.now();
  let grewAt = startedAt;
  let heldAt = startedAt;
  const near = (a: Place, b: Place) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  const step = () => {
    const { scrollWidth, scrollHeight } = document.documentElement;
    const now = `${scrollWidth}x${scrollHeight}`;
    // Moved while the page stayed the same size: that's the reader, dragging a scrollbar say, which sends no wheel,
    // touch or key. A change of size can move it too, as the browser keeps what's on screen in place.
    if (now === size && !near(here(), seen)) return stop();
    if (now !== size) {
      size = now;
      grewAt = performance.now();
      window.scrollTo(place.x, place.y);
      // Across as well as down: a page not yet as wide as it was gets there down only.
      if (near(here(), place)) return stop();
    }
    seen = here();
    const at = performance.now();
    if (scrollRestoreHeld()) {
      grewAt = heldAt = at;
      if (at - startedAt > HELD_AT_MOST_MS) return stop();
    } else if (at - grewAt > WAIT_FOR_GROWTH_MS || at - heldAt > RESTORE_AT_MOST_MS) return stop();
    frame = requestAnimationFrame(step);
  };
  const onKey = (event: KeyboardEvent) => {
    if (scrollsThePage(event)) stop();
  };
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchmove", stop);
    window.removeEventListener("keydown", onKey);
    done();
  }
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchmove", stop, { passive: true });
  window.addEventListener("keydown", onKey);
  step();
  return stop;
}

/** BrowserRouter leaves the window where it was, so a new page opened as far down as the last one was scrolled.
 *  Only a new path resets: a query change (filters, sorting, an open dialog) stays put. Back and forward return to
 *  where the entry was left: the browser tries as well, but a page still filling in is too short for it to get there,
 *  so the place is kept here and scrolled back to as the page grows. Grids of models put their pages back at once
 *  (useRememberedList), so theirs is reached straight away. An entry with no place kept, and a reload, are left to the
 *  browser. */
export default function ScrollReset() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const { pathname } = location;
  const entry = entryOf(location.key, location);
  const lastEntry = useRef(entry);
  const lastPathname = useRef(pathname);
  const currentEntry = useRef(entry);
  // While the window isn't where the reader put it, nothing is kept: from back or forward until the entry is shown
  // (the browser's own restoring scrolls the old page meanwhile), and while a place is being scrolled back to.
  const settling = useRef(false);
  // Ends the restore still under way, if there is one.
  const stopRestore = useRef<(() => void) | null>(null);

  // Layout, not passive: signing out unmounts this while App scrolls to the top, and a listener still there when that
  // scroll arrives would keep the top as the place of the entry being left.
  useLayoutEffect(() => {
    const keep = () => {
      if (!settling.current) places.set(currentEntry.current, here());
    };
    const traverse = () => {
      // The entry back or forward goes to, as the effect below will see it (the router's key is the entry's
      // state.key, or "default" without one). The same entry means nothing moves between entries: a restore still
      // under way stops, as it was for where the reader was before.
      const to = entryOf((window.history.state as { key?: string } | null)?.key ?? "default", window.location);
      if (to !== currentEntry.current) settling.current = true;
      else stopRestore.current?.();
    };
    window.addEventListener("scroll", keep, { passive: true });
    window.addEventListener("popstate", traverse);
    return () => {
      window.removeEventListener("scroll", keep);
      window.removeEventListener("popstate", traverse);
    };
  }, []);

  useLayoutEffect(() => {
    // Mounting (and signing in, which mounts the router afresh) isn't a move between entries.
    if (lastEntry.current === entry) return;
    lastEntry.current = entry;
    currentEntry.current = entry;
    const newPage = lastPathname.current !== pathname;
    lastPathname.current = pathname;
    if (navigationType === "POP") {
      const place = places.get(entry);
      if (place === undefined) {
        settling.current = false;
        return;
      }
      settling.current = true;
      const stop = scrollBackTo(place, () => {
        settling.current = false;
        stopRestore.current = null;
      });
      stopRestore.current = stop;
      return stop;
    }
    settling.current = false;
    if (newPage) window.scrollTo(0, 0);
    // Kept now too, as an entry that's never scrolled (a query change, a page that fits the window) has no scroll event.
    places.set(entry, here());
  }, [entry, pathname, navigationType]);

  return null;
}
