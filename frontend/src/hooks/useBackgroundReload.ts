import { useRef } from "react";

// The most the server gives in one page of models.
const MOST_AT_ONCE = 1000;

/** How many models to ask for when a list reloads by itself: as many as are showing, so nobody loses their place. */
export const keepLoaded = (pageSize: number, loaded: number) => Math.min(MOST_AT_ONCE, Math.max(pageSize, loaded));

/** For a page's load effect that also runs when `version` moves, because an import finished somewhere else. Nobody
 *  asked for that reload, so it shouldn't blank the page or report a failure. Call it once per run of the effect: true
 *  when this run is that reload. */
export function useBackgroundReload(version: number): () => boolean {
  const seen = useRef(version);
  return () => {
    const moved = seen.current !== version;
    seen.current = version;
    return moved;
  };
}
