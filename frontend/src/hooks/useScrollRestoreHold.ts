import { useLayoutEffect } from "react";

// How many pages are still loading what a back or forward restore is waiting for.
let holds = 0;

/** While `active`, a back or forward restore (ScrollReset) keeps waiting for the page to grow, however long its list
 *  takes to load, instead of giving up after a while. The reader scrolling still ends it. */
export function useScrollRestoreHold(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    holds += 1;
    return () => {
      holds -= 1;
    };
  }, [active]);
}

/** Whether a page is still loading what a restore is waiting for. */
export const scrollRestoreHeld = (): boolean => holds > 0;
