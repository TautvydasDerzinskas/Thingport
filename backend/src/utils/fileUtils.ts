import path from "node:path";
import { decodeExtended, parse as parseDisposition } from "content-disposition";
import mimeTypes from "mime-types";
import { IMPORT_ALLOWED_EXTS } from "../config";

// The whole C0 and C1 range: C1 is what a mis-decoded header leaves behind, and downstream systems
// (e.g. OneDrive backups) reject some of those characters.
// oxlint-disable-next-line no-control-regex -- stripping control chars is the point here.
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeFilename(name: string | null | undefined): string {
  let cleaned = (name || "").replace(CONTROL_CHARS_RE, "").trim();
  cleaned = cleaned.replace(/\//g, "_").replace(/\\/g, "_");
  cleaned = path.basename(cleaned);
  return cleaned || "imported-file";
}

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

export function parseContentDisposition(cd: string | null | undefined): string | null {
  if (!cd) return null;
  const { parameters } = parseDisposition(cd, { extended: false });
  // RFC 6266: `filename*` (RFC 8187, names its own charset) wins; one that can't be decoded falls back to `filename`.
  const extended = parameters["filename*"] === undefined ? undefined : decodeExtended(parameters["filename*"]);
  if (extended) return extended;
  if (parameters.filename) return decodeLatin1AsUtf8(parameters.filename);
  return matchLooseFilename(cd);
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
    name = sanitizeFilename(override);
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
    name = sanitizeFilename(name);
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
  return name;
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
