// What Download adapted's buttons on the page (button.ts) and its rows in Grab's bubble (rows.ts) share: their
// pictures and icons, how a file is named and sized, and how something laid over the page is put in its place.

import { slicerMark } from "../../adapter/slicers/marks.generated";
import type { AdaptTarget } from "../../shared/adaptTargets";
import { t } from "../../shared/i18n";
import { printerArtSvg } from "../../shared/printerArt";
import type { AdaptFile } from "./site";

export const ICONS = {
  // Material Design "Lightbulb" (Apache 2.0), the web app's icon for the same option.
  bulb: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7"/></svg>',
  caret:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10l5 5 5-5z"/></svg>',
  check:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  download:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  gear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Markup made here only, from numbers and fixed paths: parsed as SVG, never as page HTML. */
export function svg(markup: string): Element {
  return document.importNode(new DOMParser().parseFromString(markup, "image/svg+xml").documentElement, true);
}

/** A copy's picture in a list: its printer drawn, or its slicer's mark on a white tile. */
export function targetPicture(target: AdaptTarget, className: string): HTMLElement {
  const box = element("span", className);
  if (target.printer) {
    box.append(
      svg(
        printerArtSvg(target.printer).replace('<svg class="pa"', '<svg xmlns="http://www.w3.org/2000/svg" class="pa"'),
      ),
    );
    return box;
  }
  const mark = slicerMark(target.slicer ?? "prusaslicer");
  box.classList.add(`${className}--mark`);
  box.append(
    svg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" aria-hidden="true" focusable="false">${mark.paths
        .map((p) => `<path d="${p.d}" fill="${p.fill}"/>`)
        .join("")}</svg>`,
    ),
  );
  return box;
}

/** A file as sites show it: its title, else its name without the extension. */
export const shownName = (file: AdaptFile) => file.title || file.name.replace(/\.3mf$/i, "");

const KB = 1024;

/** "817 kB", "3.6 MB", as Printables writes them; empty when the size isn't known. */
export function sizeText(bytes: number | null): string {
  if (bytes === null) return "";
  return bytes < KB * KB
    ? t("adaptPage.sizeKb", { size: Math.max(1, Math.round(bytes / KB)) })
    : t("adaptPage.sizeMb", { size: (bytes / KB / KB).toFixed(1) });
}

/** Puts a `position: fixed` element at a place in the window. A transformed ancestor makes `fixed` count from that
 *  ancestor instead, so where it lands is measured and the difference taken off. */
export function placeFixed(el: HTMLElement, left: number, top: number): void {
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const landed = el.getBoundingClientRect();
  if (Math.abs(landed.left - left) > 0.5) el.style.left = `${2 * left - landed.left}px`;
  if (Math.abs(landed.top - top) > 0.5) el.style.top = `${2 * top - landed.top}px`;
}
