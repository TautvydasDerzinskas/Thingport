import path from "node:path";
import mimeTypes from "mime-types";
import { IMPORT_ALLOWED_EXTS } from "../config";

// The whole C0 and C1 range, not just NUL. C1 (U+0080-U+009F) is what a mis-decoded header
// leaves behind, and a control character in a filename survives the local filesystem happily but
// is rejected further downstream -- OneDrive answers 400 Bad Request for the subset undefined in
// Windows-1252 (0x81 0x8D 0x8F 0x90 0x9D) and accepts the rest, so a backup silently keeps some
// names and drops others.
// oxlint-disable-next-line no-control-regex -- stripping control chars is the point here.
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeFilename(name: string | null | undefined): string {
  let cleaned = (name || "").replace(CONTROL_CHARS_RE, "").trim();
  cleaned = cleaned.replace(/\//g, "_").replace(/\\/g, "_");
  cleaned = path.basename(cleaned);
  return cleaned || "imported-file";
}

/**
 * HTTP header values are ISO-8859-1 (RFC 7230 section 3.2.4), so a server that puts raw UTF-8
 * bytes in the plain `filename=` parameter -- rather than the `filename*=UTF-8''...` form that
 * exists for exactly this -- hands us one character per byte. MakerWorld's CDN does this, which
 * turned `哨子.3mf` into `å<93>¨å­<90>.3mf` on disk.
 *
 * Re-read those bytes as UTF-8, but only when they round-trip exactly. Invalid UTF-8 decodes to
 * U+FFFD and therefore re-encodes to different bytes, so a genuinely Latin-1 `café.stl` is left
 * alone instead of being mangled by the fix.
 */
function decodeLatin1AsUtf8(value: string): string {
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  const bytes = Buffer.from(value, "latin1");
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : value;
}

export function parseContentDisposition(cd: string | null | undefined): string | null {
  if (!cd) return null;
  // `filename*=` is already percent-encoded with its charset named, so it needs no repair.
  const starMatch = cd.match(/filename\*=([^']*)''([^;]+)/i);
  if (starMatch) return decodeURIComponent(starMatch[2]);
  const plainMatch = cd.match(/filename="?([^";]+)"?/i);
  return plainMatch ? decodeLatin1AsUtf8(plainMatch[1]) : null;
}

export class HttpError extends Error {
  status: number;
  // Machine-readable discriminator for the rare case a frontend needs to branch on *why* a
  // request failed rather than just show `message` -- e.g. EMAIL_NOT_VERIFIED, which needs a
  // "resend verification email" affordance instead of a plain error toast.
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
