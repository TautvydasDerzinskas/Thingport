import { UnauthorizedError } from "../../api/client";
import { PrintApiError, type PreviewImage, type Print, type printsApi } from "../../api/prints";
import { newLocalId } from "../../utils/localId";

export type ImageItem =
  | { kind: "existing"; id: string; url: string }
  | { kind: "new"; localId: string; file: File; previewUrl: string; pendingUploadId?: string }
  | { kind: "unconfirmed"; localId: string; previewUrl: string };

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

function unconfirmedImage(image: NewImageItem): ImageItem {
  return { kind: "unconfirmed", localId: image.localId, previewUrl: image.previewUrl };
}

function applyImageResult(image: NewImageItem, id: string | null, storedImages: Map<string, string>): ImageItem {
  if (id === null) return image.pendingUploadId ? { ...image, pendingUploadId: undefined } : image;
  const url = storedImages.get(id);
  // Another editor may already have removed a confirmed image.
  return url === undefined ? unconfirmedImage(image) : { kind: "existing", id, url };
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
  const lockPending = async () => {
    report({
      ...latest,
      items: latest.items.map((image) => (isPendingPreviewImage(image) ? unconfirmedImage(image) : image)),
    });
    report({ ...latest, print: await api.get(print.id) });
  };

  const hasReceipts = await reconcile();
  if (!hasReceipts) {
    if (latest.items.some(isPendingPreviewImage)) {
      await lockPending();
      return latest;
    }
    if (latest.items.some((image) => image.kind === "unconfirmed")) return latest;
  }

  const beforeUpload = latest;
  const uploads = latest.items.map((image) =>
    image.kind === "new" && !image.pendingUploadId ? { ...image, pendingUploadId: newLocalId() } : image,
  );
  const submitted = uploads.filter(isPendingPreviewImage);
  if (!submitted.length) return latest;
  report({ ...latest, items: uploads });

  try {
    const result = await api.addPreviewImages(
      print.id,
      submitted.map((image) => image.file),
      hasReceipts ? submitted.map((image) => image.pendingUploadId) : undefined,
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
      if (!hasReceipts || !(await reconcile())) await lockPending();
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
