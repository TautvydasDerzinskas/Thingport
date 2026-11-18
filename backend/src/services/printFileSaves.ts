/** The rows of files still on their way into storage (printFileService.saveFileFromTemp). Each row is made, and given
 *  its place, before its file is put there: a sweep for missing files would take it for gone, and a move of the
 *  model's files would point it somewhere new while the file still lands where it was going. Both leave it be. */
export const savesUnderWay = new Set<string>();

// The storagePath a file's row has from when it's made until its place is claimed: one of its own, as the column is
// unique, and one no rendered path can be, since a path's segments never hold ":". Rows made before were all "pending".
export const PENDING_STORAGE_PREFIX = "pending:";
export const isPendingStoragePath = (storagePath: string) =>
  storagePath === "pending" || storagePath.startsWith(PENDING_STORAGE_PREFIX);

/** A model's file rows with those still on their way in left out: a row has its place before its bytes are there,
 *  so one listed then would answer 404, and stay listed if the save failed. */
export function settledFiles<T extends { id: string; storagePath: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isPendingStoragePath(row.storagePath) && !savesUnderWay.has(row.id));
}

/** The files a move of their model's files passed by because they were on their way in: each follows once its save
 *  is done (printFileService.saveFileFromTemp), or it stays where the model's files used to be. */
export const movesMissed = new Set<string>();
