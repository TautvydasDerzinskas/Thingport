/** A Content-Disposition parameter: its name, then its value quoted (backslash escapes and all) or bare. */
const PARAMETER = /;\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/g;
// oxlint-disable-next-line no-control-regex -- a name never holds control characters, wherever they came from.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** The file name a Content-Disposition header gives (RFC 6266): its `filename*` (RFC 5987, how a name beyond ASCII
 *  comes) when that reads as UTF-8, else its `filename`, quoted or not; null when it names none. */
export function dispositionFilename(header: string): string | null {
  const params = new Map<string, string>();
  for (const [, name, quoted, bare] of header.matchAll(PARAMETER)) {
    const key = name.toLowerCase();
    if (!params.has(key)) params.set(key, quoted !== undefined ? quoted.replace(/\\(.)/g, "$1") : bare);
  }
  const clean = (name: string) => name.replace(CONTROL, "").trim() || null;
  const extended = /^utf-8'[^']*'(.*)$/i.exec(params.get("filename*") ?? "");
  if (extended) {
    try {
      const name = clean(decodeURIComponent(extended[1]));
      if (name) return name;
    } catch {
      // Malformed: the plain one below.
    }
  }
  const plain = params.get("filename");
  return plain ? clean(plain) : null;
}

export function filenameFromDisposition(res: Response, fallback: string): string {
  return dispositionFilename(res.headers.get("content-disposition") || "") ?? fallback;
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
