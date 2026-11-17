export function filenameFromDisposition(res: Response, fallback: string): string {
  const dispo = res.headers.get("content-disposition") || "";
  // A name beyond ASCII comes in filename*, the plain filename holding a stand-in for it.
  const extended = dispo.match(/filename\*=UTF-8''([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed: the plain one below.
    }
  }
  // Quoted, a name holds what a bare one can't ("Parts; small.csv"), with \" and \\ for a quote and a backslash.
  const quoted = dispo.match(/filename="((?:[^"\\]|\\.)*)"/i);
  if (quoted) return quoted[1].replace(/\\(.)/g, "$1") || fallback;
  const bare = dispo.match(/filename=([^";\s]+)/i);
  return (bare && bare[1]) || fallback;
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

/** Bytes offered as a file under the name given, whatever the response they came in said. */
export async function saveBlobToDisk(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
