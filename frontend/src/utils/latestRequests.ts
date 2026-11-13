/** Tickets for requests that replace one another: only the newest one's answer counts. `next()` starts one and gives
 *  back whether it's still the newest; `cancel()` makes none of them current, for when the answer has nowhere to go
 *  (unmounted, or the feature switched off). A slower answer to an older request is dropped rather than shown over a
 *  newer one. */
export function latestRequests(): { next: () => () => boolean; cancel: () => void } {
  let current = 0;
  return {
    next() {
      const mine = ++current;
      return () => mine === current;
    },
    cancel() {
      current += 1;
    },
  };
}
