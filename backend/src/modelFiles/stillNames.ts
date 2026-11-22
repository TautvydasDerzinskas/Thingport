import type { Plate, PrintFile } from "@prisma/client";
import { prisma } from "../db";

// Fs 2's second half (docs/STORAGE_DEVELOPMENT.md): once a model's file is open (storageFs.ts, openStored), its row is
// read again by id, and what was opened is served only while the row still names that path. A file put at the path
// since belongs to another row, or to none. Sizes aren't compared: a file edited in place is still the row's.

/** Whether the plate, read again, still names the file it named: the same path in storage and the same source. */
export function plateStillNames(plate: Pick<Plate, "id" | "storagePath" | "sourcePath">): () => Promise<boolean> {
  return async () => {
    const now = await prisma.plate.findUnique({
      where: { id: plate.id },
      select: { storagePath: true, sourcePath: true },
    });
    return now?.storagePath === plate.storagePath && now.sourcePath === plate.sourcePath;
  };
}

/** Whether a supporting file or prepared print, read again, still names its file: the same model, role and path, and
 *  with `prepared`, still the model's prepared print. */
export function printFileStillNames(
  file: Pick<PrintFile, "id" | "printId" | "role" | "storagePath">,
  { prepared = false } = {},
): () => Promise<boolean> {
  return async () => {
    const now = await prisma.printFile.findUnique({
      where: { id: file.id },
      select: { printId: true, role: true, storagePath: true, preparedFor: { select: { id: true } } },
    });
    return (
      now?.printId === file.printId &&
      now.role === file.role &&
      now.storagePath === file.storagePath &&
      (!prepared || now.preparedFor?.id === file.printId)
    );
  };
}
