// Grab's icon dressed up for the season, as the web app's sidebar logo is (frontend's Wordmark.tsx). The overlays
// are drawn for the whole logo, the mark beside the name, in its coordinates: the mark is the square 0..100, the
// name runs on to 411, and most seasons put their main prop (a pumpkin, a cake, the cup) past its end. Grab shows the
// mark alone, so its edition is the overlay around the mark, with that prop brought in as a badge at its corner.
// April Fools' is Grab's own: turned upside down, as the web app's logo is, the mark alone looks much the same, so it
// wears a disguise instead, and the floating icon dodges the pointer rather than reaching for it.

import type { Season } from "./season";

type Box = [x: number, y: number, width: number, height: number];

/** What the edition shows, in the logo's coordinates: the part around the mark, and where it reaches to. */
const FRAME: Box = [-40, -50, 172, 172];
/** Up to just short of the name's first letter. */
const MARK_AREA: Box = [-40, -50, 146, 172];
/** Where the badge goes: over the mark's lower right corner, a little past it but short of the popup's title. */
const BADGE_AT: Box = [58, 60, 54, 54];
/** Where the prop is: past the end of the name. */
const PROP: Box = [404, -10, 100, 100];

/** Seasons whose prop sits elsewhere, or that have none (their overlay is all around the mark already). */
const PROPS: Partial<Record<Season, Box | null>> = {
  aprilFools: null,
  holi: null,
  newYear: null,
  christmas: [408, -4, 96, 96],
  muertos: [410, 18, 66, 66],
  programmersDay: [414, 16, 60, 60],
  valentines: [404, 12, 80, 80],
  jonines: [418, 4, 76, 90],
  hanukkah: [416, 6, 80, 80],
  ramadan: [420, 8, 76, 76],
  summer: [418, 8, 72, 72],
  coffee: [410, -4, 90, 90],
};

// The extension's icon (assets/thingport-icon-color.svg, viewBox 4 4 72 72) draws the same hexagon 1/1.0882 the size
// of the logo's, around the same centre (50, 50): its box is the logo's 10.82..89.18.
const ICON_BOX = { start: 50 - 36 * 1.0882, size: 72 * 1.0882 };

/** Where the edition's picture goes over the icon, as percentages of the icon's box. */
export const SEASONAL_PLACEMENT = {
  left: `${((FRAME[0] - ICON_BOX.start) / ICON_BOX.size) * 100}%`,
  top: `${((FRAME[1] - ICON_BOX.start) / ICON_BOX.size) * 100}%`,
  width: `${(FRAME[2] / ICON_BOX.size) * 100}%`,
  height: `${(FRAME[3] / ICON_BOX.size) * 100}%`,
};

/** An overlay's drawing, without its outer <svg> and title; `suffix` keeps a second copy's ids apart. */
function inner(overlay: string, suffix = ""): string {
  let body = overlay
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "");
  if (suffix) {
    body = body
      .replace(/\bid="([^"]+)"/g, `id="$1${suffix}"`)
      .replace(/url\(#([^)]+)\)/g, `url(#$1${suffix})`)
      .replace(/href="#([^"]+)"/g, `href="#$1${suffix}"`);
  }
  return body;
}

const box = ([x, y, width, height]: Box) => `x="${x}" y="${y}" width="${width}" height="${height}"`;

/** The edition for `season` from its overlay's SVG, as an SVG document. A season with no prop gets no badge. */
export function composeSeasonalMark(season: Season, overlay: string): string {
  const prop = season in PROPS ? PROPS[season] : PROP;
  const badge = prop
    ? `<svg ${box(BADGE_AT)} viewBox="${prop.join(" ")}" overflow="hidden">${inner(overlay, "-badge")}</svg>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FRAME.join(" ")}" fill="none">` +
    `<defs><clipPath id="tg-mark-area"><rect ${box(MARK_AREA)}/></clipPath></defs>` +
    `<g clip-path="url(#tg-mark-area)">${inner(overlay)}</g>${badge}</svg>`
  );
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Today's edition, as the background hands it out (see seasonalIcon.ts). `dodge`: the floating icon shies away
 *  from the pointer instead of reaching for it. */
export type SeasonalIcon = { season: Season; overlay: string | null; dodge: boolean };

/** Dresses up `mark`, the icon's wrapper: lays the overlay over it, and notes the season (and a dodge) on it. */
export function dressMark(mark: HTMLElement, icon: SeasonalIcon | null, overlayClass: string): void {
  if (!icon) return;
  mark.dataset.season = icon.season;
  if (icon.dodge) mark.dataset.dodge = "";
  if (!icon.overlay) return;
  const img = document.createElement("img");
  img.className = overlayClass;
  img.src = icon.overlay;
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  img.decoding = "async";
  Object.assign(img.style, SEASONAL_PLACEMENT);
  mark.append(img);
}
