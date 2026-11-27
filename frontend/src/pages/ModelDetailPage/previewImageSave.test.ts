import { describe, expect, it } from "vitest";
import type { PreviewImage } from "../../api/prints";
import { reconcilePreviewUploads, type ImageItem } from "./previewImageSave";

const pendingImage = (id: string): ImageItem => ({
  kind: "new",
  localId: id,
  file: new File(["image"], `${id}.png`),
  previewUrl: `blob:${id}`,
});

const storedImage = (id: string, position: number, generated = false): PreviewImage => ({
  id,
  position,
  generated,
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

    expect(reconcilePreviewUploads(items, [existing], [existing, storedImage("accepted-id", 1)])).toEqual([
      { kind: "unconfirmed", localId: "skipped", previewUrl: "blob:skipped" },
      items[1],
      { kind: "unconfirmed", localId: "accepted", previewUrl: "blob:accepted" },
    ]);
  });

  it("matches a complete legacy response in upload order and ignores generated renders", () => {
    const items = [pendingImage("first"), pendingImage("second")];
    const current = [storedImage("second", 2), storedImage("render", 0, true), storedImage("first", 1)];

    expect(reconcilePreviewUploads(items, [], current)).toEqual([
      { kind: "existing", id: "first", url: "/first.jpg" },
      { kind: "existing", id: "second", url: "/second.jpg" },
    ]);
  });

  it("uses the request-specific slots to associate images after an explicit skip", () => {
    const items = [pendingImage("skipped"), pendingImage("accepted")];
    const current = [storedImage("other-upload", 0), storedImage("accepted-id", 1)];

    expect(reconcilePreviewUploads(items, [], current, [null, "accepted-id"])).toEqual([
      items[0],
      { kind: "existing", id: "accepted-id", url: "/accepted-id.jpg" },
    ]);
  });
});
