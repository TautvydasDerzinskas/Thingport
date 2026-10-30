import { describe, expect, it } from "vitest";
import { ownPictureUrl } from "./modelPicture";

const cover = (generated: boolean) => [{ id: "i1", position: 0, url: "/preview-image/i1/file.jpg", generated }];
const colours = (...own: boolean[]) => own.map((own_colors) => ({ own_colors }));

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
      ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: true, plates: colours(true), preview_images: cover(true) }),
    ).toBe("/preview-image/i1/file.jpg");
  });

  it("prefers a real picture to the colour cover", () => {
    expect(
      ownPictureUrl({
        thumb_url: "/t.jpg",
        thumb_generated: false,
        plates: colours(true),
        preview_images: cover(false),
      }),
    ).toBe("/t.jpg");
  });

  it("has none for a model with colours but no picture of them yet", () => {
    expect(ownPictureUrl({ thumb_url: "/t.jpg", thumb_generated: true, plates: colours(true) })).toBeNull();
  });

  // A grey first plate can make the cover before a coloured second one is drawn, which then leaves it as it is.
  it("has none when only a later plate has colours, as the cover can still be the grey render", () => {
    expect(
      ownPictureUrl({
        thumb_url: "/t.jpg",
        thumb_generated: true,
        plates: colours(false, true),
        preview_images: cover(true),
      }),
    ).toBeNull();
  });
});
