import { HttpError } from "../utils/fileUtils";

let switching = false;
let activeOperations = 0;

export function isDatabaseSwitching(): boolean {
  return switching;
}

/** Reserve the local database for work that cannot be quiesced by the durable queue worker. */
export function reserveDatabaseOperation(): () => void {
  if (switching) throw new HttpError(409, "A database switch is in progress");
  activeOperations++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeOperations--;
  };
}

export async function withDatabaseOperation<T>(run: () => Promise<T>): Promise<T> {
  const release = reserveDatabaseOperation();
  try {
    return await run();
  } finally {
    release();
  }
}

/** A synchronous gate keeps new background work out while database users settle. */
export async function withDatabaseSwitchGate<T>(change: () => Promise<T>): Promise<T> {
  if (switching) throw new HttpError(409, "A database switch is already in progress");
  if (activeOperations) throw new HttpError(409, "Wait for direct imports to finish before switching databases");
  switching = true;
  try {
    return await change();
  } finally {
    switching = false;
  }
}
