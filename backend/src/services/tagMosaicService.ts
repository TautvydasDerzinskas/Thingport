import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { TAG_MOSAICS } from "../config";
import { prisma } from "../db";
import { printCover } from "../dto";
import { modelImagePath } from "./modelPreviewCache";
import { normalizeTag } from "../utils/tagNormalization";

// A tag's tile shows one picture built here from its newest models' pictures, rather than ten pictures
// the browser fetches and lays out itself. It is made the first time it's asked for and kept on disk,
// under a name that changes with the pictures in it, so tagging and untagging models, a new render or a
// replaced image each give it a new URL with nothing to invalidate.
//
// "images" mosaics are the models' pictures. "renders" mosaics are their grey renders alone, laid out on
// transparent, so the browser tints the whole tile with the render colour as it does a card.

/** Pictures in a tag's mosaic, from its newest models. */
export const TAG_MOSAIC_PICTURES = 10;
/** Models looked at per tag for those pictures; more than ten, as some models have none yet. */
const CANDIDATES = 30;
const SIZE = 480;
const GAP = 4;
// Bumped when the drawing changes, so mosaics made by an older version are made again.
const FORMAT_VERSION = 1;

// The 4 x 4 grid split into as many pictures as the tag has, big and small together. Each letter is
// one picture, a, b, c... in order.
export const MOSAICS: string[][] = [
  ["aaaa", "aaaa", "aaaa", "aaaa"],
  ["aabb", "aabb", "aabb", "aabb"],
  ["aabb", "aabb", "aacc", "aacc"],
  ["aabc", "aabc", "aadd", "aadd"],
  ["aabb", "aabb", "cdee", "cdee"],
  ["aabc", "aabc", "ddee", "ffee"],
  ["aabc", "aabd", "eeff", "eegg"],
  ["abcc", "dbcc", "eeff", "ghff"],
  ["aabc", "aade", "fgii", "hgii"],
  ["aabc", "aade", "fghh", "fijj"],
];

export type MosaicKind = "images" | "renders";
type Picture = { url: string; file: string };
export type TaggedPrint = { id: string; tags: string[] };

/** Every model's tags, newest model first: enough to count tags and pick their newest models. */
export function listTaggedPrints(userId: string): Promise<TaggedPrint[]> {
  return prisma.print.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, tags: true },
  });
}

/** One tag's newest models, found by the database: the image endpoint asks for one tag at a time, and a page of
 *  tiles shouldn't each read every model's tags. Case-insensitive, as tags saved before normalization may vary. */
async function printsTagged(userId: string, tag: string): Promise<TaggedPrint[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Print"
    WHERE "userId" = ${userId} AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(t) = lower(${tag}))
    -- The same order as listTaggedPrints, so the summary's URL and the file made here agree.
    ORDER BY "createdAt" DESC, id DESC
    LIMIT ${CANDIDATES}`;
  return rows.map((row) => ({ id: row.id, tags: [tag] }));
}

/** A plate's render, only once it's on disk: tags don't queue renders, which cards and uploads do. */
function renderCover(plateId: string | null, home: string | null): Picture | null {
  if (!plateId) return null;
  const file = modelImagePath(plateId, home, "render");
  try {
    return { url: `/plate/${plateId}/render.png?v=${fsSync.statSync(file).mtimeMs}`, file };
  } catch {
    return null;
  }
}

/** Each of `tags`' pictures of each kind, from its newest models that have one; joins images and plates for those
 *  alone, in one query every kind shares. */
export async function tagPictures(
  prints: TaggedPrint[],
  tags: string[],
  kinds: readonly MosaicKind[] = ["images"],
): Promise<Map<MosaicKind, Map<string, Picture[]>>> {
  const candidates = new Map(tags.map((tag) => [tag, [] as string[]]));
  for (const print of prints) {
    for (const tag of new Set(print.tags.map(normalizeTag))) {
      const ids = candidates.get(tag);
      if (ids && ids.length < CANDIDATES) ids.push(print.id);
    }
  }
  const rows = await prisma.print.findMany({
    where: { id: { in: [...new Set([...candidates.values()].flat())] } },
    select: {
      id: true,
      assetsPath: true,
      previewImages: { orderBy: { position: "asc" }, take: 1, select: { id: true } },
      plates: { orderBy: { position: "asc" }, take: 1, select: { id: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byKind = new Map<MosaicKind, Map<string, Picture[]>>();
  for (const kind of kinds) {
    // A model under several of the tags is looked up on disk once.
    const covers = new Map<string, Picture | null>();
    const coverOf = (id: string) => {
      if (!covers.has(id)) {
        const row = byId.get(id);
        const plateId = row?.plates[0]?.id ?? null;
        covers.set(
          id,
          !row
            ? null
            : kind === "renders"
              ? renderCover(plateId, row.assetsPath)
              : printCover(row.previewImages[0]?.id ?? null, plateId, row.assetsPath),
        );
      }
      return covers.get(id);
    };
    const pictures = new Map<string, Picture[]>();
    for (const [tag, ids] of candidates) {
      const found: Picture[] = [];
      // Stops at ten, so the rest of the candidates aren't looked up on disk.
      for (const id of ids) {
        if (found.length >= TAG_MOSAIC_PICTURES) break;
        const cover = coverOf(id);
        if (cover) found.push(cover);
      }
      pictures.set(tag, found);
    }
    byKind.set(kind, pictures);
  }
  return byKind;
}

/** Changes whenever the pictures, or their order, do: each picture's URL carries its file's mtime. */
function mosaicVersion(pictures: Picture[]): string {
  return createHash("sha1")
    .update(`${FORMAT_VERSION}\n${pictures.map((picture) => picture.url).join("\n")}`)
    .digest("hex")
    .slice(0, 16);
}

/** Where the tag's mosaic is served from, or null while none of its models has a picture. */
export function tagMosaicUrl(tag: string, pictures: Picture[], kind: MosaicKind = "images"): string | null {
  if (!pictures.length) return null;
  const file = kind === "renders" ? "render-mosaic.webp" : "mosaic.webp";
  return `/tags/${encodeURIComponent(tag)}/${file}?v=${mosaicVersion(pictures)}`;
}

// Render mosaics are named apart, so making one kind never clears the other as an older version.
const RENDERS_INFIX = "r-";

function userDir(userId: string): string {
  return path.join(TAG_MOSAICS, `u-${userId}`);
}

/** Files are named by the tag's hash, so any tag name is a safe filename and its older versions are easy to find. */
function tagPrefix(tag: string): string {
  return createHash("sha1").update(tag).digest("hex").slice(0, 16);
}

/** Grid cells of each picture, as [left, top, width, height] in quarters of the tile. */
function cells(layout: string[]): [number, number, number, number][] {
  const count = new Set(layout.join("")).size;
  return Array.from({ length: count }, (_, index) => {
    const letter = String.fromCharCode(97 + index);
    const spots = layout.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === letter ? [[x, y]] : [])));
    const xs = spots.map(([x]) => x);
    const ys = spots.map(([, y]) => y);
    const [left, top] = [Math.min(...xs), Math.min(...ys)];
    return [left, top, Math.max(...xs) - left + 1, Math.max(...ys) - top + 1];
  });
}

/** The mosaic of `pictures` (one to ten files), as a square WebP with see-through gaps. Renders are fitted whole on
 *  transparent rather than cropped to fill their cell. */
export async function renderTagMosaic(pictures: { file: string }[], kind: MosaicKind = "images"): Promise<Buffer> {
  const layout = MOSAICS[pictures.length - 1];
  const step = (SIZE + GAP) / 4;
  const pieces = await Promise.all(
    cells(layout).map(async ([left, top, width, height], index) => {
      const [x, y] = [Math.round(left * step), Math.round(top * step)];
      const w = Math.round((left + width) * step - GAP) - x;
      const h = Math.round((top + height) * step - GAP) - y;
      const input = await sharp(pictures[index].file)
        .rotate()
        .resize(
          w,
          h,
          kind === "renders" ? { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } } : { fit: "cover" },
        )
        .toBuffer();
      return { input, left: x, top: y };
    }),
  );
  // The gaps stay transparent, so the tile's own colour shows through in light and dark themes alike.
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(pieces)
    .webp({ quality: 80 })
    .toBuffer();
}

/** The tag's mosaic file, made now if its pictures have changed since it was last made; null with no pictures. */
export async function ensureTagMosaic(
  userId: string,
  rawTag: string,
  kind: MosaicKind = "images",
): Promise<string | null> {
  const tag = normalizeTag(rawTag);
  if (!tag) return null;
  const pictures = (await tagPictures(await printsTagged(userId, tag), [tag], [kind])).get(kind)?.get(tag) ?? [];
  if (!pictures.length) return null;
  const dir = userDir(userId);
  const prefix = tagPrefix(tag);
  const file = path.join(dir, `${prefix}-${kind === "renders" ? RENDERS_INFIX : ""}${mosaicVersion(pictures)}.webp`);
  try {
    await fs.access(file);
    return file;
  } catch {
    // Not made yet.
  }
  await fs.mkdir(dir, { recursive: true });
  // Written aside and moved into place, so a request in the meantime never reads half a file.
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, await renderTagMosaic(pictures, kind));
  await fs.rename(temporary, file);
  await removeTagMosaics(userId, tag, { keep: file, kind });
  return file;
}

/** Drops every tag mosaic of the user's, e.g. once all their models are gone. */
export async function removeUserTagMosaics(userId: string): Promise<void> {
  await fs.rm(userDir(userId), { recursive: true, force: true });
}

/** Drops the tag's mosaics: with `older`, that kind's versions other than `older.keep`; without, every one, as when
 *  the tag is deleted. */
export async function removeTagMosaics(
  userId: string,
  rawTag: string,
  older?: { keep: string; kind: MosaicKind },
): Promise<void> {
  const dir = userDir(userId);
  const prefix = `${tagPrefix(normalizeTag(rawTag))}-`;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => {
        if (!name.startsWith(prefix) || !name.endsWith(".webp")) return false;
        if (!older) return true;
        const isRenders = name.startsWith(`${prefix}${RENDERS_INFIX}`);
        return isRenders === (older.kind === "renders") && path.join(dir, name) !== older.keep;
      })
      .map((name) => fs.rm(path.join(dir, name), { force: true })),
  );
}
