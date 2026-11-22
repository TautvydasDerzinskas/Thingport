// One rule for a file's name, applied wherever a name comes in: an upload, a file added to a model, an import, a zip
// entry, the consume folder, a partner's copy, a tool or Studio. Everything after that reads the name this makes, so
// two ways in never disagree about what a file is called or what it is.

/** A name normalizeFileName made. Only it makes one, so a writer that takes a NormalName can't be handed a raw one. */
export type NormalName = string & { readonly __normalName: unique symbol };

/** The most a name may take on disk, in UTF-8 bytes. ext4 and most file systems allow 255 per path segment; the rest
 *  leaves room for " (2)" when two files want the same name. */
export const NAME_MAX_BYTES = 240;

/** Extensions read as one, so numbering and the kind of file go by the whole of them. */
const COMPOUND_EXTENSIONS = [".gcode.3mf", ".tar.gz"];

/** What follows a name's last dot when it's an extension: a short run of letters and digits. "v1.2 final" has none. */
const EXTENSION = /^\.[A-Za-z0-9_-]{1,15}$/;

// The whole C0 and C1 range and DEL: C1 is what a mis-decoded header leaves behind, and some backup tools reject it.
// oxlint-disable-next-line no-control-regex -- stripping control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** What Windows won't name a file, whatever its extension. */
const RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Left behind by the systems a folder or zip was made on, never content: macOS's resource forks and folder
 *  settings, Windows' thumbnail cache and folder settings, and other hidden files. */
const SYSTEM_FILES = new Set(["thumbs.db", "desktop.ini"]);

/** What a name may not end in: the dots and spaces Windows drops, and any other whitespace. */
const TRAILING = /[.\s]+$/;

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `text` cut to at most `maxBytes` UTF-8 bytes and `maxLength` UTF-16 units, between characters as people see
 *  them. */
function cut(text: string, maxBytes: number, maxLength = Infinity): string {
  if (bytes(text) <= maxBytes && text.length <= maxLength) return text;
  let out = "";
  for (const { segment } of graphemes.segment(text)) {
    if (bytes(out + segment) > maxBytes || out.length + segment.length > maxLength) break;
    out += segment;
  }
  return out;
}

/** A name's stem and extension. A compound extension is read whole; a name that is only a dot and a word (".gltf")
 *  is all stem, as `path.extname` reads it, and so is one whose last dot isn't followed by an extension. */
export function splitName(name: string): { stem: string; ext: string } {
  const lower = name.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((ext) => lower.endsWith(ext) && lower.length > ext.length);
  if (compound) return { stem: name.slice(0, -compound.length), ext: name.slice(-compound.length) };
  const dot = name.lastIndexOf(".");
  return dot > 0 && EXTENSION.test(name.slice(dot))
    ? { stem: name.slice(0, dot), ext: name.slice(dot) }
    : { stem: name, ext: "" };
}

/** `stem` + `ext` within NAME_MAX_BYTES, cutting the stem so the extension survives. What a cut leaves at the end is
 *  trimmed as the name's own end is, so normalising again changes nothing. */
function fit(stem: string, ext: string): string {
  if (bytes(stem + ext) <= NAME_MAX_BYTES) return stem + ext;
  if (bytes(ext) >= NAME_MAX_BYTES) return cut(stem + ext, NAME_MAX_BYTES).replace(TRAILING, "");
  return cut(stem, NAME_MAX_BYTES - bytes(ext)).replace(TRAILING, "") + ext;
}

/** `name` within `maxLength` UTF-16 units as well as NAME_MAX_BYTES, cut from the stem so its extension survives:
 *  a storage path's segment, which keeps a length cap of its own. */
export function cutName(name: string, maxLength: number): string {
  if (name.length <= maxLength && bytes(name) <= NAME_MAX_BYTES) return name;
  const { stem, ext } = splitName(name);
  if (ext.length >= maxLength || bytes(ext) >= NAME_MAX_BYTES)
    return cut(name, NAME_MAX_BYTES, maxLength).replace(TRAILING, "");
  return cut(stem, NAME_MAX_BYTES - bytes(ext), maxLength - ext.length).replace(TRAILING, "") + ext;
}

/**
 * The name a file is kept under, from what came with it (a picked file's name, a header, a zip entry's last part):
 * without control characters, then composed (NFC), with "/" and "\" made "_", trimmed, without the trailing dots and
 * whitespace Windows drops, with "_" after a name Windows reserves, and at most NAME_MAX_BYTES long, cut from the stem.
 * Running it again changes nothing. A name with nothing left is `fallback`.
 */
export function normalizeFileName(raw: string | null | undefined, fallback = "imported-file"): NormalName {
  // Control characters go first: one between a letter and its accent keeps NFC from composing them.
  const cleaned = (raw ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .normalize("NFC")
    .replace(/[/\\]/g, "_")
    .trim()
    .replace(TRAILING, "");
  const { stem, ext } = splitName(cleaned || fallback);
  // A reserved name is looked for in what's left once the name fits: a cut can leave one ("CON" and its spaces).
  const fitted = splitName(fit(stem, ext));
  return (
    RESERVED_STEM.test(fitted.stem) ? fit(`${fitted.stem}_`, fitted.ext) : fitted.stem + fitted.ext
  ) as NormalName;
}

/** `name` numbered apart: "job (2).gcode.3mf" for the second "job.gcode.3mf", still within NAME_MAX_BYTES and, for a
 *  storage path's segment, `maxLength` UTF-16 units: the stem gives way, never the number or the extension. */
export function numberedName(name: NormalName, n: number, maxLength = Infinity): NormalName {
  const { stem, ext } = splitName(name);
  const suffix = ` (${n})`;
  const kept = cut(stem, NAME_MAX_BYTES - bytes(suffix + ext), maxLength - suffix.length - ext.length);
  return `${kept.length < stem.length ? kept.replace(TRAILING, "") : kept}${suffix}${ext}` as NormalName;
}

/** What makes two names the same file in one folder of a model: case doesn't count, as on most desktops. */
export function nameKey(folder: string | null | undefined, name: NormalName): string {
  return `${(folder ?? "").normalize("NFC").toLowerCase()}/${name.toLowerCase()}`;
}

/** Whether a path in a folder or zip is something its system left there rather than content: anything under
 *  `__MACOSX/` or a hidden folder, a hidden file (".DS_Store", "._part.stl", any name starting with a dot), Thumbs.db
 *  or desktop.ini. A leading "./", as some zip tools write, isn't a hidden folder. */
export function isJunk(entryPath: string): boolean {
  const levels = entryPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((level) => level && level !== "." && level !== "..");
  const name = levels.at(-1) ?? "";
  return levels.some((level) => level === "__MACOSX" || level.startsWith(".")) || SYSTEM_FILES.has(name.toLowerCase());
}
