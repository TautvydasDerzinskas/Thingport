import path from "node:path";
import type { Print } from "@prisma/client";
import { STORAGE } from "../config";
import { folderLevels } from "../utils/fileFolder";
import { HttpError } from "../utils/fileUtils";
import { ASSETS_FOLDER } from "../services/modelAssets";
import { cutName } from "../files/names";

export const STORAGE_TEMPLATE_TOKENS = [
  "category-or-folder",
  "collection",
  "tags",
  "creator",
  "model",
  "filename",
  "id",
  "plate",
] as const;

// Older names still accepted in a saved template, and rewritten to the current one whenever the
// template is validated -- so the admin page shows (and the next save stores) the new name.
// {name} was always the same value as {model}; {category} became {category-or-folder} when folders
// were split out of categories.
const LEGACY_TOKEN_ALIASES: Record<string, (typeof STORAGE_TEMPLATE_TOKENS)[number]> = {
  name: "model",
  category: "category-or-folder",
};

/** The {collection} folder for a model in no collection, and for one in more than one. */
export const NO_COLLECTION_FOLDER = "Uncollected";
export const MULTIPLE_COLLECTIONS_FOLDER = "Multiple collections";

export const DEFAULT_STORAGE_TEMPLATE = "{category-or-folder}/{model}/{filename}";

const TOKEN_RE = /\{([a-z_-]+)\}/g;
// oxlint-disable-next-line no-control-regex -- stripping control chars is the point here.
const INVALID_SEGMENT_RE = /[<>:"|?*\x00-\x1f]/g;

/** How long a storage path's segment may be, in UTF-16 units, as well as fitting NAME_MAX_BYTES. */
export const PATH_SEGMENT_MAX = 120;

export function sanitizePathSegment(value: string | null | undefined, fallback: string): string {
  let cleaned = (value || "").trim().replace(INVALID_SEGMENT_RE, "_");
  cleaned = cleaned
    .replace(/\//g, "_")
    .replace(/\\/g, "_")
    .replace(/^[ .]+|[ .]+$/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") cleaned = fallback;
  // Its extension kept, and within the bytes a file system allows for a name, which 120 CJK characters are not.
  return cutName(cleaned, PATH_SEGMENT_MAX);
}

/** Trimmed, with "/" separators and current token names; not yet checked. */
export function normalizeStorageTemplate(template: string | null | undefined): string {
  return (template || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(TOKEN_RE, (match, token: string) =>
      token in LEGACY_TOKEN_ALIASES ? `{${LEGACY_TOKEN_ALIASES[token]}}` : match,
    );
}

export function validateStorageTemplate(template: string | null | undefined): string {
  const normalized = normalizeStorageTemplate(template);
  if (!normalized) throw new HttpError(400, "Storage template cannot be empty");
  const tokens = [...normalized.matchAll(TOKEN_RE)].map((m) => m[1]);
  const unknown = tokens.filter((t) => !(STORAGE_TEMPLATE_TOKENS as readonly string[]).includes(t));
  if (unknown.length) throw new HttpError(400, `Unknown storage token: {${unknown[0]}}`);
  const filenameCount = (normalized.match(/\{filename\}/g) || []).length;
  if (filenameCount !== 1) throw new HttpError(400, "Storage template must contain {filename} exactly once");
  const finalSegment = normalized.split("/").pop() || "";
  if (!finalSegment.includes("{filename}")) {
    throw new HttpError(400, "{filename} must be in the final path segment");
  }
  const stripped = normalized.replace(TOKEN_RE, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    throw new HttpError(400, "Storage template contains an invalid token");
  }
  if (normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new HttpError(400, "Storage template contains an unsafe path segment");
  }
  return normalized;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN_RE, (_match, token: string) => {
    if (!(token in values)) throw new HttpError(400, `Unknown storage token: {${token}}`);
    return values[token];
  });
}

export function assertWithinStorage(relative: string): string {
  const candidate = path.resolve(STORAGE, relative);
  const root = path.resolve(STORAGE);
  if (candidate === root || !candidate.startsWith(root + path.sep)) {
    throw new HttpError(400, "Storage template resolved outside the storage directory");
  }
  return relative;
}

export type PrintLike = Pick<
  Print,
  "id" | "name" | "creator" | "tags" | "categoryId" | "userId" | "authorId" | "sourceProvider"
>;

export function templateUses(template: string, token: (typeof STORAGE_TEMPLATE_TOKENS)[number]): boolean {
  return template.includes(`{${token}}`);
}

export type PrintTemplateValues = Record<string, string>;

/** {plate} with the separator next to it taken out, for the files that aren't plates: "{model}-{plate}-{filename}"
 *  gives "{model}-{filename}". A folder per plate ("Plate {plate}/") goes whole, so they sit beside the plates'
 *  folders. */
function withoutPlateToken(template: string): string {
  const segments = template.split("/");
  return segments
    .map((segment, index) =>
      index < segments.length - 1 && segment.includes("{plate}")
        ? ""
        : segment.replace(/([ _.-]*)\{plate\}([ _.-]*)/g, (match, before: string, after: string, offset: number) =>
            offset === 0 || offset + match.length === segment.length ? "" : before || after,
          ),
    )
    .join("/");
}

/** `plate` is the plate's number, or null for any other file of the model. */
export function renderModelPath(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
  filename: string,
  plate: number | null,
): string {
  const values = {
    ...printValues,
    filename: sanitizePathSegment(filename, "file"),
    plate: plate === null ? "" : String(plate + 1),
  };
  const rendered = renderTemplate(plate === null ? withoutPlateToken(template) : template, values).replace(/\\/g, "/");
  const parts = rendered
    .split("/")
    .filter(Boolean)
    .map((part) => sanitizePathSegment(part, "item"));
  if (!parts.length) throw new HttpError(400, "Storage template produced an empty path");
  const userSegment = sanitizePathSegment(`u-${print.userId}`, "user");
  return assertWithinStorage(path.join(userSegment, ...parts));
}

/** A file of the model in one of its folders: in a folder where the template would put a file named like the folder's
 *  first level, as the pictures' Images folder is placed, so a template that gives each model a folder of its own nests
 *  it there ("Props/Gadget/Plugs/Plug.stl") and one that keeps models side by side gives it a folder beside the model's
 *  files ("Props/Gadget - Plugs/Gadget - Plug.stl"). A source's folder named like the pictures' goes beside them. */
export function renderFilePath(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
  filename: string,
  plate: number | null,
  folder: string | null | undefined,
): string {
  const flat = renderModelPath(print, template, printValues, filename, plate);
  const levels = folderLevels(folder).map((level) => sanitizePathSegment(level, "Folder"));
  if (!levels.length) return flat;
  if (levels[0].toLowerCase() === ASSETS_FOLDER.toLowerCase()) levels[0] = `${levels[0]} (files)`;
  const home = renderModelPath(print, template, printValues, levels[0], null);
  return assertWithinStorage(path.join(home, ...levels.slice(1), path.basename(flat)));
}

/** The model's pictures folder: where the template would put a file named "Images", so it sits beside the model's
 *  files -- "Props/Gadget/Images", or "Props/Gadget - Images" under a template that keeps models side by side. */
export function renderAssetsPath(print: PrintLike, template: string, printValues: PrintTemplateValues): string {
  return renderModelPath(print, template, printValues, ASSETS_FOLDER, null);
}

export function samplePlateStoragePaths(template: string): [string, string] {
  const safeTemplate = validateStorageTemplate(template);
  const base = {
    "category-or-folder": "Props/Workshop",
    collection: "Tabletop",
    tags: "Print in place + Useful",
    creator: "Example creator",
    model: "Multi-part gadget",
    id: "a1b2c3d4",
  };
  const first = renderTemplate(safeTemplate, { ...base, filename: "Base.3mf", plate: "1" });
  const second = renderTemplate(safeTemplate, { ...base, filename: "Lid.3mf", plate: "2" });
  return [first, second];
}
