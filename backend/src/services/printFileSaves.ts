// The storagePath a file's row has from when its save makes it until its place is claimed: one of its own, as the
// column is unique, and one no rendered path can be, since a path's segments never hold ":". Rows made before were all
// "pending". Such a row isn't ready (PrintFile.ready) either, so nothing lists or moves it, and the missing-files sweep
// passes it by. The clean-up at startup deletes such rows, leaving whatever is at a placeholder's path alone.
export const PENDING_STORAGE_PREFIX = "pending:";
export const isPendingStoragePath = (storagePath: string) =>
  storagePath === "pending" || storagePath.startsWith(PENDING_STORAGE_PREFIX);

/** A file row nothing may list or move, and the missing-files sweep passes by: its save isn't done, or it's at a
 *  placeholder an older version left. Only the clean-up at startup takes such a row (removeAbandonedPrintFileSaves). */
export const isUnsettled = (row: { ready: boolean; storagePath: string }) =>
  !row.ready || isPendingStoragePath(row.storagePath);
