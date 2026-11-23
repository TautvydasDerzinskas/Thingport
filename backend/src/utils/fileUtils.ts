import crypto from "node:crypto";
import path from "node:path";
import { create as createDisposition, decodeExtended, parse as parseDisposition } from "content-disposition";
import mimeTypes from "mime-types";
import { IMPORT_ALLOWED_EXTS } from "../config";
import { NAME_MAX_BYTES, normalizeFileName, splitName } from "../files/names";

/**
 * Header values are ISO-8859-1, so a server putting raw UTF-8 in `filename=` (MakerWorld's CDN
 * does) yields one character per byte. Re-read them as UTF-8 only when they round-trip exactly, so
 * a genuinely Latin-1 name is left alone.
 */
function decodeLatin1AsUtf8(value: string): string {
  // Anything above U+00FF was decoded properly, and latin1 encoding would truncate it.
  if (!/[\u0080-\u00ff]/.test(value) || /[\u0100-\uffff]/.test(value)) return value;
  const bytes = Buffer.from(value, "latin1");
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : value;
}

// RFC 8187 allows "%" only before two hex digits. decodeExtended rejects a stray one for UTF-8 but keeps it for
// ISO-8859-1, which would let `bad%GG.stl` win over a valid `filename`.
const MALFORMED_PERCENT_RE = /%(?![0-9a-f]{2})/i;

export function parseContentDisposition(cd: string | null | undefined): string | null {
  if (!cd) return null;
  const { parameters } = parseDisposition(cd, { extended: false });
  // RFC 6266: `filename*` (RFC 8187, names its own charset) wins; one that can't be decoded falls back to `filename`.
  const raw = parameters["filename*"];
  const extended = raw === undefined || MALFORMED_PERCENT_RE.test(raw) ? undefined : decodeExtended(raw);
  if (extended) return extended;
  if (parameters.filename) return decodeLatin1AsUtf8(parameters.filename);
  return matchLooseFilename(cd);
}

/** A name in ASCII, for a client that reads only `filename`: each character beyond printable ASCII, each quote and
 *  backslash, and each "%" that would read as an escape, percent-encoded. Two names never come out as one. */
function asciiName(name: string): string {
  return name.replace(/[^\x20-\x7e]|["\\]|%(?=[0-9A-Fa-f]{2})/gu, (char) => encodeURIComponent(char));
}

/** The Content-Disposition a download named `name` goes out with. Browsers read the whole name from `filename*`. A
 *  client that reads only `filename`, as `curl -OJ` does, gets `asciiName`, where the package's own stand-in has a "?"
 *  for each such character. One too long for a disk once encoded keeps as much of the name as fits, whole characters,
 *  then a tag from the whole name, so two long names stay two, and its extension. */
export function attachmentDisposition(name: string): string {
  return contentDisposition(name, "attachment");
}

/** As attachmentDisposition, for a file shown in place. */
export function inlineDisposition(name: string): string {
  return contentDisposition(name, "inline");
}

function contentDisposition(name: string, type: "attachment" | "inline"): string {
  // Half a surrogate pair, which a name from a JSON body can hold, can't be encoded: it goes out as U+FFFD.
  const whole = name.replace(/\p{Cs}/gu, "\ufffd");
  let ascii = asciiName(whole);
  if (ascii.length > NAME_MAX_BYTES) {
    const { stem, ext } = splitName(whole);
    const tail = `~${crypto.createHash("sha256").update(whole).digest("hex").slice(0, 8)}${asciiName(ext)}`;
    const chars = [...stem];
    let kept = chars.length;
    while (kept > 0 && asciiName(chars.slice(0, kept).join("")).length + tail.length > NAME_MAX_BYTES) kept--;
    ascii = asciiName(chars.slice(0, kept).join("")) + tail;
  }
  return createDisposition(whole, ascii === whole ? { type } : { type, fallback: ascii });
}

/** For headers the parser finds no filename in, such as `filename=x.stl` with no disposition type. */
function matchLooseFilename(cd: string): string | null {
  const starMatch = cd.match(/filename\*=([^']*)''([^;]+)/i);
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[2]);
    } catch {
      // Not UTF-8 percent-encoding; try the plain parameter.
    }
  }
  const plainMatch = cd.match(/filename="?([^";]+)"?/i);
  return plainMatch ? decodeLatin1AsUtf8(plainMatch[1]) : null;
}

export class HttpError extends Error {
  status: number;
  // For the rare case the frontend must branch on why a request failed, e.g. EMAIL_NOT_VERIFIED.
  code?: string;
  // Set when the failure is worth trying again (the network, not the provider, said no).
  transient?: boolean;
  constructor(status: number, message: string, code?: string, transient?: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.transient = transient;
  }
}

export function buildImportFilename(url: string, headers: Headers, override?: string | null): string {
  let name: string;
  if (override) {
    name = normalizeFileName(override);
  } else {
    const disposition = headers.get("content-disposition");
    name = parseContentDisposition(disposition) || "";
    if (!name) {
      try {
        name = path.basename(new URL(url).pathname);
      } catch {
        name = "";
      }
    }
    name = normalizeFileName(name);
  }

  const contentType = headers.get("content-type") || "";
  const parsed = path.parse(name);
  let ext = parsed.ext.toLowerCase();
  if (!ext) {
    try {
      ext = path.extname(new URL(url).pathname).toLowerCase();
    } catch {
      ext = "";
    }
  }
  if (!ext && contentType) {
    const guessed = mimeTypes.extension(contentType.split(";")[0].trim());
    ext = guessed ? `.${guessed}` : "";
  }
  if (ext && !name.toLowerCase().endsWith(ext)) {
    name = `${parsed.name || "imported-file"}${ext}`;
  }
  if (!ext) {
    throw new HttpError(415, "Unable to determine file extension");
  }
  if (!IMPORT_ALLOWED_EXTS.has(ext)) {
    throw new HttpError(415, `Unsupported file type: ${ext}`);
  }
  // Again, as an extension added from the link or its type can take the name past the limit.
  return normalizeFileName(name);
}

export function mimeFromContentType(contentType: string | null | undefined, filename: string): string {
  const base = (contentType || "").split(";")[0].trim().toLowerCase();
  if (!base || base === "application/octet-stream" || base === "binary/octet-stream") {
    return mimeTypes.lookup(filename) || base || "application/octet-stream";
  }
  return base;
}

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  const base = (contentType || "").split(";")[0].trim().toLowerCase();
  return base === "text/html" || base === "application/xhtml+xml";
}

export function isJsonContentType(contentType: string | null | undefined): boolean {
  const base = (contentType || "").split(";")[0].trim().toLowerCase();
  return base === "application/json" || base === "text/json" || base === "application/ld+json";
}

export function guessMimeFromPath(filePath: string): string {
  return mimeTypes.lookup(filePath) || "application/octet-stream";
}
