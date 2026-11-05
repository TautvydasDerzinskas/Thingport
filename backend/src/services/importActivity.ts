import { AsyncLocalStorage } from "node:async_hooks";

// A job's last sign of life, for the worker's watchdog (services/importWorker.ts). Carried through the import pipeline
// this way rather than as an argument, as the pipeline reaches the network by many routes, one per provider. Only the
// job the worker is running has one: an import running anywhere else beside it moves nothing here.
export type ImportActivity = { lastActivity: number };

const running = new AsyncLocalStorage<ImportActivity>();

export function withImportActivity<T>(activity: ImportActivity, fn: () => T): T {
  return running.run(activity, fn);
}

export function noteImportActivity(): void {
  const activity = running.getStore();
  if (activity) activity.lastActivity = Date.now();
}
