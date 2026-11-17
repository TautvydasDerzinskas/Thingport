/** The rows of files still on their way into storage (printFileService.saveFileFromTemp). Each row is made, and given
 *  its place, before its file is put there: a sweep for missing files would take it for gone, and a move of the
 *  model's files would point it somewhere new while the file still lands where it was going. Both leave it be. */
export const savesUnderWay = new Set<string>();
