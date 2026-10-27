import { AsyncLocalStorage } from "node:async_hooks";

// An import a tool's install makes to fetch the models it brings (services/toolsService.ts): its files are copied
// out and the model it made is thrown away, so it mustn't show in the admin's activity, nor be sent to an AI provider
// to categorize or describe. Carried through the import pipeline this way rather than as an argument, as the
// pipeline reaches createPrint by many routes, one per provider.
const quiet = new AsyncLocalStorage<true>();

export function importQuietly<T>(fn: () => Promise<T>): Promise<T> {
  return quiet.run(true, fn);
}

export function importingQuietly(): boolean {
  return quiet.getStore() === true;
}
