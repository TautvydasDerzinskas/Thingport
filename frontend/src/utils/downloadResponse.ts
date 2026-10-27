export function filenameFromDisposition(res: Response, fallback: string): string {
  const dispo = res.headers.get("content-disposition") || "";
  const match = dispo.match(/filename="?([^";]+)"?/i);
  return (match && match[1]) || fallback;
}

export async function saveResponseToDisk(res: Response, fallback: string): Promise<void> {
  const filename = filenameFromDisposition(res, fallback);
  await saveBlobToDisk(await res.blob(), filename);
}

/** Bytes the browser made itself -- a generated model, a script read back out -- offered as a file. */
export async function saveBytesToDisk(bytes: Uint8Array, filename: string, type: string): Promise<void> {
  // A Uint8Array is a BlobPart; the cast is only because its buffer is typed as possibly shared.
  await saveBlobToDisk(new Blob([bytes as BlobPart], { type }), filename);
}

async function saveBlobToDisk(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
