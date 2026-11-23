// A file's row is made at this storagePath and keeps it until its place is claimed (printFileService.saveFileFromTemp):
// a save under way, with no file of its own yet.
export const PENDING_STORAGE_PATH = "pending";

/** The rows a list of a model's files shows: none still "pending". */
export function withPlace<T extends { storagePath: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.storagePath !== PENDING_STORAGE_PATH);
}
