import { describe, expect, it } from "vitest";
import type { PreviewImage } from "../../api/prints";
import { reconcilePreviewUploads, type ImageItem } from "./previewImageSave";

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
