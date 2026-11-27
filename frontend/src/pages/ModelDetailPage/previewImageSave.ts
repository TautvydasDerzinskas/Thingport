import { UnauthorizedError } from "../../api/client";
import { PrintApiError, type PreviewImage, type Print, type printsApi } from "../../api/prints";
import { newLocalId } from "../../utils/localId";

export type ImageItem =
  | { kind: "existing"; id: string; url: string }
  | { kind: "new"; localId: string; file: File; previewUrl: string; pendingUploadId?: string }
  | { kind: "unconfirmed" | "missing"; localId: string; previewUrl: string };

type NewImageItem = Extract<ImageItem, { kind: "new" }>;
type PendingImageItem = NewImageItem & { pendingUploadId: string };
export type PreviewSaveApi = Pick<typeof printsApi, "get" | "addPreviewImages" | "getPreviewUploadResults">;

export class PreviewUploadError extends Error {
  constructor(
    readonly reason: "skipped" | "pending",
    cause?: unknown,
  ) {
    super(reason, { cause });
    this.name = "PreviewUploadError";
  }
}

export function isPendingPreviewImage(image: ImageItem): image is PendingImageItem {
  return image.kind === "new" && image.pendingUploadId !== undefined;
}

export function canArrangePreviewImage(image: ImageItem): boolean {
  return image.kind === "existing" || image.kind === "new";
}

export function previewImageNeighbourIndex(items: ImageItem[], index: number, direction: -1 | 1): number {
  if (!items[index] || !canArrangePreviewImage(items[index])) return -1;
  for (let neighbour = index + direction; neighbour >= 0 && neighbour < items.length; neighbour += direction) {
    if (canArrangePreviewImage(items[neighbour])) return neighbour;
  }
  return -1;
}

export function movePreviewImage(items: ImageItem[], index: number, direction: -1 | 1): ImageItem[] {
  const neighbour = previewImageNeighbourIndex(items, index, direction);
  if (neighbour < 0) return items;
  const moved = [...items];
  [moved[index], moved[neighbour]] = [moved[neighbour], moved[index]];
  return moved;
}

function unconfirmedImage(image: NewImageItem): ImageItem {
  return { kind: "unconfirmed", localId: image.localId, previewUrl: image.previewUrl };
}

function applyImageResult(image: NewImageItem, id: string | null, storedImages: Map<string, string>): ImageItem {
  if (id === null) return image.pendingUploadId ? { ...image, pendingUploadId: undefined } : image;
  const url = storedImages.get(id);
  // Another editor may already have removed a confirmed image.
  return url === undefined
    ? { kind: "missing", localId: image.localId, previewUrl: image.previewUrl }
    : { kind: "existing", id, url };
}

export function reconcilePreviewUploads(
  items: ImageItem[],
  currentImages: PreviewImage[],
  addedIds?: (string | null)[],
): ImageItem[] {
  const storedImages = new Map(currentImages.map((image) => [image.id, image.url]));
  // On an older server the gallery snapshot alone cannot attribute any image to this upload.
  const ids = addedIds ?? [];
  const storedIds = ids.filter((id) => id !== null);
  const canMatch =
    ids.length === items.filter((image) => image.kind === "new").length && new Set(storedIds).size === storedIds.length;

  let index = 0;
  return items.map((image) => {
    if (image.kind !== "new") return image;
    return canMatch ? applyImageResult(image, ids[index++], storedImages) : unconfirmedImage(image);
  });
}

type PreviewSaveProgress = { print: Print; items: ImageItem[] };

export async function savePreviewUploads(
  print: Print,
  items: ImageItem[],
  api: PreviewSaveApi,
  onProgress: (progress: PreviewSaveProgress) => void,
): Promise<PreviewSaveProgress> {
  let latest = { print, items };
  const report = (next: PreviewSaveProgress) => {
    latest = next;
    onProgress(next);
  };

  const reconcile = async (): Promise<boolean> => {
    const pendingIds = latest.items.filter(isPendingPreviewImage).map((image) => image.pendingUploadId);
    const result = await api.getPreviewUploadResults(print.id, pendingIds);
    if (!result) return false;
    if (pendingIds.length) {
      const receipts = new Map(result.upload_results.map((receipt) => [receipt.upload_id, receipt.image_id]));
      const stored = new Map(result.print.preview_images.map((image) => [image.id, image.url]));
      report({
        print: result.print,
        items: latest.items.map((image) => {
          if (!isPendingPreviewImage(image)) return image;
          const id = receipts.get(image.pendingUploadId);
          return id === undefined ? image : applyImageResult(image, id, stored);
        }),
      });
    }
    return true;
  };
  const lockUnkeyedUploads = async () => {
    report({
      ...latest,
      items: latest.items.map((image) => (image.kind === "new" ? unconfirmedImage(image) : image)),
    });
    report({ ...latest, print: await api.get(print.id) });
  };

  const hasReceipts = await reconcile();
  if (!hasReceipts) {
    if (latest.items.some(isPendingPreviewImage)) throw new PreviewUploadError("pending");
    if (latest.items.some((image) => image.kind === "unconfirmed")) return latest;
  }

  const beforeUpload = latest;
  // Only uploads sent to the keyed endpoint carry pending IDs. A rollback must never send them through legacy.
  const uploads = hasReceipts
    ? latest.items.map((image) =>
        image.kind === "new" && !image.pendingUploadId ? { ...image, pendingUploadId: newLocalId() } : image,
      )
    : latest.items;
  const submitted = uploads.filter((image): image is NewImageItem => image.kind === "new");
  if (!submitted.length) return latest;
  report({ ...latest, items: uploads });

  try {
    const result = await api.addPreviewImages(
      print.id,
      submitted.map((image) => image.file),
      hasReceipts ? submitted.filter(isPendingPreviewImage).map((image) => image.pendingUploadId) : undefined,
    );
    report({
      print: result.print,
      items: reconcilePreviewUploads(latest.items, result.print.preview_images, result.added_image_ids),
    });
  } catch (error) {
    // Validation and auth errors reject this request before storing a file.
    if (
      error instanceof UnauthorizedError ||
      (error instanceof PrintApiError && [400, 403, 404, 413, 415, 422].includes(error.status))
    ) {
      report(beforeUpload);
      throw error;
    }
    try {
      if (hasReceipts) {
        await reconcile();
      } else {
        await lockUnkeyedUploads();
      }
    } catch (lookupError) {
      if (lookupError instanceof UnauthorizedError || latest.items.some((image) => image.kind === "unconfirmed")) {
        throw lookupError;
      }
      throw new PreviewUploadError("pending", lookupError);
    }
    if (latest.items.some(isPendingPreviewImage)) throw new PreviewUploadError("pending", error);
  }

  if (latest.items.some((image) => image.kind === "unconfirmed")) return latest;
  if (latest.items.some((image) => image.kind === "new")) throw new PreviewUploadError("skipped");
  return latest;
}

export async function savePreviewRemovals(
  print: Print,
  removedImageIds: Set<string>,
  api: Pick<typeof printsApi, "get" | "deletePreviewImage">,
  onProgress: (print: Print, remaining: Set<string>) => void,
): Promise<Print> {
  let latest = print;
  const remaining = new Set(removedImageIds);
  for (const id of removedImageIds) {
    if (latest.preview_images.some((image) => image.id === id)) {
      try {
        latest = (await api.deletePreviewImage(print.id, id)).print;
      } catch (error) {
        if (error instanceof UnauthorizedError) throw error;
        latest = await api.get(print.id);
        if (latest.preview_images.some((image) => image.id === id)) {
          onProgress(latest, new Set(remaining));
          throw error;
        }
      }
    }
    remaining.delete(id);
    onProgress(latest, new Set(remaining));
  }
  return latest;
}
