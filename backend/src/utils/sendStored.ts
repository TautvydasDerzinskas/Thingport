import type { Response } from "express";
import { isMissingError, openStored, type OpenedFile, type StorageSite } from "../modelFiles/storageFs";
import { handlePath } from "../services/fileReuse";
import { HttpError } from "./fileUtils";

// Fs 2 (docs/STORAGE_DEVELOPMENT.md): a model's file is read from the handle opened on it, and only while its row,
// read again by id, still names that path. So what goes out is the file the row named, never one put at the path
// since, and nothing goes out for a row that went or moved meanwhile.

/** A stored file as its row names it. */
export type StoredRow = {
  /** Where the row says the file is. */
  filePath: string;
  /** The door's call site the read counts under. */
  site: StorageSite;
  /** Whether the row, read again by id once the file is open, still names this path. Not its size: a file may be
   *  edited in place, and its row keeps the size it was saved with. */
  stillNames: () => Promise<boolean>;
};

/** The file a row names, open, or null when no regular file is there or the row no longer names it once it's open.
 *  Any other error throws. The caller closes the handle. */
export async function openRowFile(row: StoredRow): Promise<OpenedFile | null> {
  const opened = await openStored(row.filePath, row.site);
  if (!opened) return null;
  try {
    if (await row.stillNames()) return opened;
  } catch (err) {
    await opened.handle.close();
    throw err;
  }
  await opened.handle.close();
  return null;
}

const notFound = () => new HttpError(404, "Not found");

/** Serves the file a row names from its open handle, with send's Range, ETag and 304 as from a path. Throws the
 *  routes' 404 when no regular file is there or the row no longer names it: send's own 404 isn't exposed, so the
 *  error handler would answer it with a 500. Any other error is thrown as it is. `headers` are set only once there's
 *  a file to send, so a 404 never goes out as an attachment. Resolves once the answer is sent. */
export async function sendStored(res: Response, row: StoredRow & { headers: () => void }): Promise<void> {
  const opened = await openRowFile(row);
  if (!opened) throw notFound();
  try {
    row.headers();
    await new Promise<void>((resolve, reject) => {
      res.sendFile(handlePath(opened.handle), (err?: NodeJS.ErrnoException) => {
        // As express does without a callback: a client gone or a failed write only ends the answer.
        if (!err || err.code === "ECONNABORTED" || err.syscall === "write") resolve();
        else reject(isMissingError(err) && !res.headersSent ? notFound() : err);
      });
    });
  } finally {
    // Only once it's sent: send reopens the file through the handle's path, and reads it until then.
    await opened.handle.close();
  }
}
