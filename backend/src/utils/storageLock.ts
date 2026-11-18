// Serialises moving or swapping a file in managed storage with the check right before it (printService.moveAllStored,
// fileReuseBackfill's swapOne), so neither renames under the other between its check and its rename. In-process only:
// a second backend on the same storage wouldn't see it.

let tail: Promise<unknown> = Promise.resolve();
// Every turn at the lock so far, for storageLockTurn.
let turns = 0;

/** Runs `fn` after every call made before it has finished, whether those succeeded or not. Not reentrant: `fn` must
 *  not take the lock itself, or it waits for itself for good. */
export function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const turn = () => {
    turns += 1;
    return fn();
  };
  const run = tail.then(turn, turn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The number of the turn at the lock, read in a `fn`: a later turn of the caller's whose number is just one more
 *  had no other in between, so nothing in storage moved meanwhile -- not even away and back. */
export function storageLockTurn(): number {
  return turns;
}
