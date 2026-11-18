/** A Content-Disposition header's parameters by lowercased name, the first of each: a quoted value read whole, its
 *  semicolons and all, with \" and \\ for a quote and a backslash. */
function dispositionParams(header: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const match of header.matchAll(/;\s*([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g)) {
    const name = match[1].toLowerCase();
    if (params.has(name)) continue;
    params.set(name, match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : match[3].trim());
  }
  return params;
}

export function filenameFromDisposition(res: Response, fallback: string): string {
  const params = dispositionParams(res.headers.get("content-disposition") || "");
  // A name beyond ASCII comes in filename*, the plain filename holding a stand-in for it. Only as a parameter of its
  // own: a quoted name can hold the same text ("Parts; filename*=UTF-8''notes.csv").
  const extended = params.get("filename*")?.match(/^UTF-8''(.+)$/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed: the plain one below.
    }
  }
  return params.get("filename") || fallback;
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
