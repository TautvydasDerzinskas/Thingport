import type { PreviewImage } from "../../api/prints";

export type ImageItem =
  | { kind: "existing"; id: string; url: string }
  | { kind: "new"; localId: string; file: File; previewUrl: string }
  | { kind: "unconfirmed"; localId: string; previewUrl: string };

export function reconcilePreviewUploads(
  items: ImageItem[],
  previousImages: PreviewImage[],
  currentImages: PreviewImage[],
  addedIds?: (string | null)[],
): ImageItem[] {
  const previousIds = new Set(previousImages.map((image) => image.id));
  const storedImages = new Map(currentImages.map((image) => [image.id, image.url]));
  const ids =
    addedIds ??
    currentImages
      .filter((image) => !image.generated && !previousIds.has(image.id))
      .toSorted((a, b) => a.position - b.position)
      .map((image) => image.id);
  const storedIds = ids.filter((id) => id !== null);
  const canMatch =
    ids.length === items.filter((image) => image.kind === "new").length &&
    new Set(storedIds).size === storedIds.length &&
    storedIds.every((id) => storedImages.has(id));

  let index = 0;
  return items.map((image) => {
    if (image.kind !== "new") return image;
    if (!canMatch) return { kind: "unconfirmed", localId: image.localId, previewUrl: image.previewUrl };
    const id = ids[index++];
    return id === null ? image : { kind: "existing", id, url: storedImages.get(id) ?? image.previewUrl };
  });
}
