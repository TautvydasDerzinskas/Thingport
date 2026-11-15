// Regex-based on purpose: model files can be hundreds of MB, too big for a DOM parser.

export function normalizePath(p: string | null | undefined): string {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

export function pathKey(p: string): string {
  return normalizePath(p).toLowerCase();
}

export function escapeXml(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Text as XML stores it, its entities read: what's written out again goes through escapeXml once. */
export function decodeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()];
    const code =
      name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function parseAttrs(attrStr: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr || ""))) attrs[m[1]] = decodeXml(m[2]);
  return attrs;
}

/** `<metadata key=".." value=".."/>` pairs, as Bambu's model_settings.config writes them. */
export function readMetadata(xml: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const re = /<metadata\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    if (attrs.key) meta[attrs.key] = attrs.value;
  }
  return meta;
}

// indexOf rather than match(): a regex match on a big mesh allocates millions of strings.
export function countOccurrences(xml: string, needle: string): number {
  let count = 0;
  for (let at = xml.indexOf(needle); at !== -1; at = xml.indexOf(needle, at + needle.length)) count++;
  return count;
}
