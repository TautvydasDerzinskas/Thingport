import { HttpError } from "../utils/fileUtils";

let switching = false;

export function isDatabaseSwitching(): boolean {
  return switching;
}

/** A synchronous gate keeps new background work out while database users settle. */
export async function withDatabaseSwitchGate<T>(change: () => Promise<T>): Promise<T> {
  if (switching) throw new HttpError(409, "A database switch is already in progress");
  switching = true;
  try {
    return await change();
  } finally {
    switching = false;
  }
}
