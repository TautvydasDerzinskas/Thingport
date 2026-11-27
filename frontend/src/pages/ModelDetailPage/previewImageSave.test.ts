import { describe, expect, it, vi } from "vitest";
import type { PreviewImage, Print } from "../../api/prints";
import {
  isPendingPreviewImage,
  reconcilePreviewUploads,
  savePreviewUploads,
  type ImageItem,
  type PreviewSaveApi,
} from "./previewImageSave";

const pendingImage = (id: string): ImageItem => ({
  kind: "new",
  localId: id,
  file: new File(["image"], `${id}.png`),
  previewUrl: `blob:${id}`,
});

const storedImage = (id: string, position: number): PreviewImage => ({
  id,
  position,
  url: `/${id}.jpg`,
});

describe("reconcilePreviewUploads", () => {
  it("leaves every submitted row unconfirmed if a legacy response skipped an image", () => {
    const existing = storedImage("existing", 0);
    const items: ImageItem[] = [
      pendingImage("skipped"),
      { kind: "existing", id: existing.id, url: existing.url },
      pendingImage("accepted"),
    ];

    expect(reconcilePreviewUploads(items, [existing, storedImage("accepted-id", 1)])).toEqual([
      { kind: "unconfirmed", localId: "skipped", previewUrl: "blob:skipped" },
      items[1],
      { kind: "unconfirmed", localId: "accepted", previewUrl: "blob:accepted" },
    ]);
  });

  it("leaves legacy rows unconfirmed even when a concurrent upload makes the counts match", () => {
    const items = [pendingImage("skipped"), pendingImage("accepted")];
    const current = [storedImage("other-upload", 0), storedImage("accepted-id", 1)];

    expect(reconcilePreviewUploads(items, current)).toEqual([
      { kind: "unconfirmed", localId: "skipped", previewUrl: "blob:skipped" },
      { kind: "unconfirmed", localId: "accepted", previewUrl: "blob:accepted" },
    ]);
  });

  it("uses the request-specific slots to associate images after an explicit skip", () => {
    const items = [pendingImage("skipped"), pendingImage("accepted")];
    const current = [storedImage("other-upload", 0), storedImage("accepted-id", 1)];

    expect(reconcilePreviewUploads(items, current, [null, "accepted-id"])).toEqual([
      items[0],
      { kind: "existing", id: "accepted-id", url: "/accepted-id.jpg" },
    ]);
  });
});

const printWithImages = (...preview_images: PreviewImage[]): Print => ({
  id: "model",
  name: "Model",
  created_at: "2026-01-01T00:00:00.000Z",
  tags: [],
  plates: [],
  preview_images,
  supporting_file_count: 0,
  view_count: 0,
  print_count: 0,
  is_favorite: false,
});

function previewSaveFixture(...items: ImageItem[]) {
  const api = {
    get: vi.fn<PreviewSaveApi["get"]>(),
    getPreviewUploadResults: vi.fn<PreviewSaveApi["getPreviewUploadResults"]>(),
    addPreviewImages: vi.fn<PreviewSaveApi["addPreviewImages"]>(),
  };
  let progress = { print: printWithImages(), items };
  const save = () =>
    savePreviewUploads(progress.print, progress.items, api, (update) => {
      progress = update;
    });
  return { api, save, progress: () => progress };
}

describe("savePreviewUploads", () => {
  it("recovers stored images after a lost response and sends only the unresolved file on retry", async () => {
    const { api, save, progress } = previewSaveFixture(pendingImage("first"), pendingImage("second"));
    const firstAdded = printWithImages(storedImage("first-saved", 0));
    const bothAdded = printWithImages(...firstAdded.preview_images, storedImage("second-saved", 1));
    api.getPreviewUploadResults.mockResolvedValue({ print: printWithImages(), upload_results: [] });
    api.addPreviewImages.mockImplementationOnce(async (_printId, _files, ids) => {
      if (!ids) throw new Error("Expected upload IDs");
      api.getPreviewUploadResults.mockResolvedValue({
        print: firstAdded,
        upload_results: [{ upload_id: ids[0], image_id: "first-saved" }],
      });
      throw new Error("Response lost");
    });
    api.addPreviewImages.mockResolvedValueOnce({ print: bothAdded, added_image_ids: ["second-saved"] });

    await expect(save()).rejects.toMatchObject({ reason: "pending" });
    const [first, second] = progress().items;
    expect(first).toEqual({ kind: "existing", id: "first-saved", url: "/first-saved.jpg" });
    expect(isPendingPreviewImage(second)).toBe(true);

    const saved = await save();
    expect(saved.items.map((image) => image.kind)).toEqual(["existing", "existing"]);
    expect(api.addPreviewImages).toHaveBeenCalledTimes(2);
    const [, resentFiles, resentIds] = api.addPreviewImages.mock.calls[1];
    expect(resentFiles.map((file) => file.name)).toEqual(["second.png"]);
    expect(resentIds).toEqual([api.addPreviewImages.mock.calls[0][2]?.[1]]);
  });

  it("stops on a skipped image, keeps successful rows, and retries the skipped file with a new ID", async () => {
    const { api, save, progress } = previewSaveFixture(pendingImage("first"), pendingImage("second"));
    const firstAdded = printWithImages(storedImage("first-saved", 0));
    const bothAdded = printWithImages(...firstAdded.preview_images, storedImage("second-saved", 1));
    api.getPreviewUploadResults.mockResolvedValue({ print: firstAdded, upload_results: [] });
    api.addPreviewImages
      .mockResolvedValueOnce({ print: firstAdded, added_image_ids: ["first-saved", null] })
      .mockResolvedValueOnce({ print: bothAdded, added_image_ids: ["second-saved"] });

    await expect(save()).rejects.toMatchObject({ reason: "skipped" });
    expect(progress().items[0]).toMatchObject({ kind: "existing", id: "first-saved" });
    expect(isPendingPreviewImage(progress().items[1])).toBe(false);

    await expect(save()).resolves.toMatchObject({ print: bothAdded });
    const [, resentFiles, resentIds] = api.addPreviewImages.mock.calls[1];
    expect(resentFiles.map((file) => file.name)).toEqual(["second.png"]);
    expect(resentIds).not.toEqual([api.addPreviewImages.mock.calls[0][2]?.[1]]);
  });

  it("refreshes and locks a legacy upload after a lost response", async () => {
    const { api, save } = previewSaveFixture(pendingImage("first"));
    const current = printWithImages(storedImage("saved-by-legacy", 0));
    api.getPreviewUploadResults.mockResolvedValue(null);
    api.get.mockResolvedValue(current);
    api.addPreviewImages.mockRejectedValue(new Error("Response lost"));

    await expect(save()).resolves.toEqual({
      print: current,
      items: [{ kind: "unconfirmed", localId: "first", previewUrl: "blob:first" }],
    });
    expect(api.addPreviewImages).toHaveBeenCalledExactlyOnceWith("model", [expect.any(File)], undefined);
  });
});
