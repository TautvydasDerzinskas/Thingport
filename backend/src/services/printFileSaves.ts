/** The rows of files still on their way into storage (printFileService.saveFileFromTemp). Each row is made, and given
 *  its place, before its file is put there: a sweep for missing files would take it for gone, and a move of the
 *  model's files would point it somewhere new while the file still lands where it was going. Both leave it be. */
export const savesUnderWay = new Set<string>();

// The storagePath a file's row has from when it's made until its place is claimed: one of its own, as the column is
// unique, and one no rendered path can be, since a path's segments never hold ":". Rows made before were all "pending".
export const PENDING_STORAGE_PREFIX = "pending:";
export const isPendingStoragePath = (storagePath: string) =>
  storagePath === "pending" || storagePath.startsWith(PENDING_STORAGE_PREFIX);
