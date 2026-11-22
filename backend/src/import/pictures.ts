import { IMPORT_BROWSER_USER_AGENT, IMPORT_PREVIEW_IMAGE_DELAY_MS } from "../config";
import { readCapped } from "../utils/readCapped";
import { rawFetch } from "../services/guardedFetch";
import { sleep } from "../utils/concurrency";
import { addPreviewImage, preferImageOverRenders } from "../services/previewImageService";
import { getPhotosPerModel } from "../services/settingsService";

const PREVIEW_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
export const PREVIEW_IMAGE_MAX_COUNT = 20;

export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await rawFetch(url, { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "image/*" });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > PREVIEW_IMAGE_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const { buffer, truncated } = await readCapped(res, PREVIEW_IMAGE_MAX_BYTES);
    return truncated ? null : buffer;
  } catch {
    return null;
  }
}

/** Best-effort: stores the page's cover (at position 0) and gallery as preview images, and seeds
 * the plate thumbnail from the cover when nothing better exists. A 3D render the app made while
 * the import ran (the model is browsable from creation) gives way to them. Never throws.
 *
 * Answers with how many of them are stored, a picture whose fetch came back with nothing being skipped as it
 * always was: a gallery being replaced goes only once this is more than none (replaceModelFiles). */
export async function attachImportedPreviewImages(
  printId: string | undefined,
  plateId: string | undefined,
  coverImageUrl: string | null | undefined,
  galleryImages: { url: string; filename: string }[],
  paceMs?: number,
): Promise<number> {
  if (!printId) return 0;
  const seen = new Set<string>();
  const orderedUrls: string[] = [];
  if (coverImageUrl) {
    orderedUrls.push(coverImageUrl);
    seen.add(coverImageUrl);
  }
  for (const image of galleryImages) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    orderedUrls.push(image.url);
  }

  let firstAdded = false;
  let stored = 0;
  const urls = orderedUrls.slice(0, PREVIEW_IMAGE_MAX_COUNT);
  // Administration → Storage's "Photos kept per model"; one that couldn't be fetched doesn't count.
  const keep = (await getPhotosPerModel()) ?? PREVIEW_IMAGE_MAX_COUNT;
  const delayMs = paceMs ?? IMPORT_PREVIEW_IMAGE_DELAY_MS;
  for (let i = 0; i < urls.length && stored < keep; i++) {
    await sleep(delayMs);
    const buf = await fetchImageBytes(urls[i]);
    if (!buf) continue;
    const added = await addPreviewImage(printId, buf);
    if (!added) continue;
    stored++;
    if (!firstAdded) {
      firstAdded = true;
      await preferImageOverRenders(printId, plateId, buf);
    }
  }
  return stored;
}
