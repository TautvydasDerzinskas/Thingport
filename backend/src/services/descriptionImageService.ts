import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../config";
import { prisma } from "../db";
import {
  assetPath,
  assetTarget,
  descriptionImageFile,
  printAssetHome,
  removeAsset,
  type AssetHome,
} from "./modelAssets";
import { ensureAssetHome } from "./printService";
import { mapWithConcurrency } from "../utils/concurrency";
import { validateRemoteUrl } from "../utils/urlUtils";
import { browserFetch, needsBrowserFetch } from "../utils/browserFetch";
import { readCapped } from "../utils/readCapped";

const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
// Step-by-step assembly guides run long; this still bounds a hostile description.
const IMAGE_MAX_COUNT = 80;
const DOWNLOAD_CONCURRENCY = 4;
const MAX_REDIRECTS = 5;
// For all of one description's downloads together, so slow hosts can't stretch an import out.
const DOWNLOAD_BUDGET_MS = 2 * 60 * 1000;

// Kept byte-for-byte rather than re-encoded, so animated GIFs stay animated. SVG is left out:
// served from our own origin it could run script.
const ALLOWED_FORMATS: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const REMOTE_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const LOCAL_REF_RE = /\/description-image\/([a-z0-9]+)/g;

/** `home` is the image's model's Print.assetsPath. */
export function descriptionImagePath(image: { id: string; mime: string }, home: AssetHome): string {
  return assetPath(home, descriptionImageFile(image));
}

/** Relative to the API base; the frontend adds the base and auth token when rendering. */
function descriptionImageRef(id: string): string {
  return `/description-image/${id}`;
}

/** Redirects are followed by hand so every hop is checked before it's requested; the
 *  source is third-party content, so a redirect to an internal address must never be fetched. */
async function fetchImage(url: string, deadline: number): Promise<Buffer | null> {
  const timeLeft = Math.min(IMPORT_TIMEOUT_SECONDS * 1000, deadline - Date.now());
  if (timeLeft <= 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeLeft);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await validateRemoteUrl(current);
      const headers = { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "image/*" };
      const res = needsBrowserFetch(current)
        ? await browserFetch(current, { headers, redirect: "manual", signal: controller.signal })
        : await fetch(current, { headers, redirect: "manual", signal: controller.signal });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined);
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const { buffer, truncated } = await readCapped(res, IMAGE_MAX_BYTES);
      return truncated ? null : buffer;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function imageMime(buffer: Buffer): Promise<string | null> {
  try {
    const { format } = await sharp(buffer, { animated: true }).metadata();
    return (format && ALLOWED_FORMATS[format]) || null;
  } catch {
    return null;
  }
}

/** Null when the bytes aren't an allowed image. */
async function saveDescriptionImage(printId: string, buffer: Buffer, sourceUrl: string | null) {
  const mime = await imageMime(buffer);
  if (!mime) return null;
  const row = await prisma.descriptionImage.create({ data: { printId, sourceUrl, mime, size: buffer.length } });
  try {
    const dest = assetTarget(await ensureAssetHome(printId), descriptionImageFile(row));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buffer);
  } catch {
    await prisma.descriptionImage.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  return row;
}

/** Downloads the remote images in a print's notes and points the notes at the local copies.
 *  An image that can't be fetched in time keeps its remote URL. Best-effort; never throws. */
export async function localizeDescriptionImages(printId: string): Promise<void> {
  try {
    const print = await prisma.print.findUnique({ where: { id: printId }, select: { notes: true } });
    const notes = print?.notes ?? "";
    const urls = [...new Set([...notes.matchAll(REMOTE_IMAGE_RE)].map((match) => match[2]))].slice(0, IMAGE_MAX_COUNT);
    if (urls.length) {
      const existing = await prisma.descriptionImage.findMany({
        where: { printId, sourceUrl: { in: urls } },
        select: { id: true, sourceUrl: true },
      });
      const localByUrl = new Map(existing.map((image) => [image.sourceUrl!, image.id]));
      const missing = urls.filter((url) => !localByUrl.has(url));
      const deadline = Date.now() + DOWNLOAD_BUDGET_MS;
      await mapWithConcurrency(missing, DOWNLOAD_CONCURRENCY, async (url) => {
        const buffer = await fetchImage(url, deadline);
        const saved = buffer ? await saveDescriptionImage(printId, buffer, url) : null;
        if (saved) localByUrl.set(url, saved.id);
      });
      const rewritten = notes.replace(REMOTE_IMAGE_RE, (match, alt: string, url: string) => {
        const id = localByUrl.get(url);
        return id ? `![${alt}](${descriptionImageRef(id)})` : match;
      });
      // Only onto the notes it started from: an edit saved meanwhile wins, and its images are
      // left for that edit's own run.
      if (rewritten !== notes) {
        await prisma.print.updateMany({ where: { id: printId, notes }, data: { notes: rewritten } });
      }
    }
    await pruneDescriptionImages(printId);
  } catch (err) {
    console.error("Failed to store description images", printId, err);
  }
}

/** Drops the stored images the print's notes no longer reference, e.g. after an edit. */
export async function pruneDescriptionImages(printId: string): Promise<void> {
  const print = await prisma.print.findUnique({ where: { id: printId }, select: { notes: true } });
  const referenced = new Set([...(print?.notes ?? "").matchAll(LOCAL_REF_RE)].map((match) => match[1]));
  const images = await prisma.descriptionImage.findMany({ where: { printId }, select: { id: true, mime: true } });
  const unused = images.filter((image) => !referenced.has(image.id));
  if (!unused.length) return;
  await prisma.descriptionImage.deleteMany({ where: { id: { in: unused.map((image) => image.id) } } });
  const home = await printAssetHome(printId);
  for (const image of unused) await removeAsset(home, descriptionImageFile(image));
}

export async function deleteAllDescriptionImages(printId: string): Promise<void> {
  const rows = await prisma.descriptionImage.findMany({ where: { printId }, select: { id: true, mime: true } });
  await prisma.descriptionImage.deleteMany({ where: { printId } });
  const home = await printAssetHome(printId);
  for (const row of rows) await removeAsset(home, descriptionImageFile(row));
}
