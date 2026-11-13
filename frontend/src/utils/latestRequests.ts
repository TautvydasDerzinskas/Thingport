/** Tickets for requests that replace one another. `next()` starts one and gives back the check to make when its answer
 *  comes: true unless a newer request's answer has been taken already, so a slower answer to an older request is
 *  dropped rather than shown over a newer one, yet still counts when the newer one fails. `cancel()` makes every
 *  request started so far count for nothing, for when the answer has nowhere to go (unmounted, the feature switched
 *  off) or is out of date (a save since). */
export function latestRequests(): { next: () => () => boolean; cancel: () => void } {
  let started = 0;
  let taken = 0;
  return {
    next() {
      const mine = ++started;
      return () => {
        if (mine < taken) return false;
        taken = mine;
        return true;
      };
    },
    cancel() {
      taken = ++started;
    },
  };
}
