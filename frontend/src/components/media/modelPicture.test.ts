import { describe, expect, it } from "vitest";
import { ownPictureUrl } from "./modelPicture";

const cover = (generated: boolean) => [{ id: "i1", position: 0, url: "/preview-image/i1/file.jpg", generated }];

describe("ownPictureUrl", () => {
  it("takes the plate's thumbnail when it came with the model", () => {
    expect(ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: false })).toBe("/t.jpg");
  });

  it("has none for a model we only drew ourselves", () => {
    expect(ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: true, preview_images: cover(true) })).toBeNull();
  });

  // A generated or painted model: the thumbnail is the grey render, and the cover beside it is the colour one.
  it("takes the colour cover of a model that brought colours of its own", () => {
    expect(
      ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: true, own_colors: true, preview_images: cover(true) }),
    ).toBe("/preview-image/i1/file.jpg");
  });

  it("prefers a real picture to the colour cover", () => {
    expect(
      ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: false, own_colors: true, preview_images: cover(false) }),
    ).toBe("/t.jpg");
  });

  it("has none for a model with colours but no picture of them yet", () => {
    expect(ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: true, own_colors: true })).toBeNull();
  });
});
