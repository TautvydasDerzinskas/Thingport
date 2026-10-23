// Serialises moving or swapping a file in managed storage with the check right before it (printService.moveAllStored,
// fileReuseBackfill's swapOne), so neither renames under the other between its check and its rename. In-process only:
// a second backend on the same storage wouldn't see it.

let tail: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every call made before it has finished, whether those succeeded or not. Not reentrant: `fn` must
 *  not take the lock itself, or it waits for itself for good. */
export function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
