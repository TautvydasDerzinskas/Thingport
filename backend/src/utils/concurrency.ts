export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `sleep`, but a no-op when `ms` is unset. */
export function maybeSleep(ms: number | undefined): Promise<void> {
  return ms ? sleep(ms) : Promise.resolve();
}

/** Preserves item order in the results. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Runs tasks for the same key one after another; different keys don't wait on each other. */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  return function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    tails.set(key, next);
    // Both ways, not `finally`: that hands on a rejection nobody holds, and an unhandled one ends the process.
    const cleanup = () => {
      if (tails.get(key) === next) tails.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  };
}
