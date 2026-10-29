import type { PreviewImage } from "../../api/prints";

type Pictured = {
  thumb_url?: string | null;
  thumb_generated?: boolean;
  own_colors?: boolean;
  preview_images?: PreviewImage[];
};

/**
 * The picture that is the model's own, for the view that shows pictures rather than renders; null for a model we
 * have only our own grey render of, which that view then falls back to.
 *
 * Usually the plate's thumbnail, unless it is one we drew. A model that brought colours of its own -- a painted
 * project, a script's `color()` calls -- is drawn in them too, and that picture, its cover, is the model as it
 * would come off the plate: the thing someone looking at pictures wants. The grey render beside it is what the
 * renders view tints, so a list of renders still reads as one set (see backend previewImageService.ts).
 */
export function ownPictureUrl(print: Pictured): string | null {
  if (print.thumb_url && !print.thumb_generated) return print.thumb_url;
  const cover = print.preview_images?.[0];
  return print.own_colors && cover?.generated ? cover.url : null;
}
