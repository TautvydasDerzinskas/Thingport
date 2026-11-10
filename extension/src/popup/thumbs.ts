// The square, clickable thumbnails of the History tab's grids.

import { opensInTab } from "./dom";

/** `image` is a data URL or a provider's own image URL; without one, or if it fails, the title's first letter. */
export function thumbLink({
  url,
  title,
  image,
  label,
  badge,
}: {
  url: string;
  title: string | null;
  image: string | null;
  /** Read out when there's no title. */
  label: string;
  /** Laid over a corner, e.g. the provider's logo. */
  badge?: Element;
}): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "recent-item";
  link.href = url;
  link.title = title || "";
  link.setAttribute("aria-label", title || label);
  opensInTab(link);

  const placeholder = () => {
    link.prepend((title || "?").trim().charAt(0).toUpperCase() || "?");
  };
  if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = "";
    // Some image hosts turn away requests that name another site as the referrer.
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.remove();
      placeholder();
    });
    link.append(img);
  } else {
    placeholder();
  }
  if (badge) {
    const wrap = document.createElement("span");
    wrap.className = "recent-item__badge";
    wrap.append(badge);
    link.append(wrap);
  }
  return link;
}
