// The tiles Adapt 3MFs' settings are made of: a slicer by its mark (the web app's, adapter/slicers/marks.ts), a
// printer by its drawn outline (shared/printerArt.ts). A tile that can be switched on is a button with aria-pressed;
// one that only shows what's set is a plain element.

import { slicerMark } from "../adapter/slicers/marks.generated";
import { printerArtSvg, type ArtPrinter } from "../shared/printerArt";
import { SLICER_LABELS } from "../shared/slicers";

const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

/** A small stroked icon, as the popup's others are drawn. */
export function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export const ICONS = {
  check: ["M20 6 9 17l-5-5"],
  chevron: ["m9 18 6-6-6-6"],
  open: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  plus: ["M12 5v14", "M5 12h14"],
};

export function slicerMarkSvg(id: string, size: number): SVGSVGElement {
  const mark = slicerMark(id);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", mark.viewBox);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const { d, fill } of mark.paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fill);
    svg.append(path);
  }
  return svg;
}

const tick = (className: string) => el("span", className, icon(ICONS.check));

/** A slicer's mark on a white tile, as the web app shows it, and its name. With `pressed`, a button that switches. */
export function slicerTile(id: string, pressed?: boolean): HTMLElement {
  const name = SLICER_LABELS[id] ?? id;
  const parts = [el("span", "st__logo", slicerMarkSvg(id, 24)), el("span", "st__name", name)];
  if (pressed === undefined) return el("div", "st st--still", ...parts);
  const button = el("button", "st", ...parts, tick("st__check"));
  button.type = "button";
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

/** A printer as a tile shows it. */
export type ShownPrinter = ArtPrinter & { id: string; brandName: string; model: string; nozzle?: string };

function printerParts(printer: ShownPrinter): HTMLElement[] {
  const art = el("span", "pt__art");
  // Numbers only: nothing in it comes from outside Grab.
  art.innerHTML = printerArtSvg(printer);
  return [art, el("span", "pt__brand", printer.brandName), el("span", "pt__model", printer.model)];
}

const fullName = (printer: ShownPrinter) =>
  `${printer.brandName} ${printer.model}${printer.nozzle ? `, ${printer.nozzle} mm nozzle` : ""}`;

/** A printer's tile: a button where it does something (`pressed` makes it one that switches), else a plain one. */
export function printerTile(
  printer: ShownPrinter,
  as: { button: false } | { button: true; pressed?: boolean },
): HTMLElement {
  if (!as.button) {
    const still = el("div", "pt pt--still", ...printerParts(printer));
    still.title = fullName(printer);
    return still;
  }
  const button = el("button", "pt", ...printerParts(printer));
  button.type = "button";
  button.title = fullName(printer);
  if (as.pressed !== undefined) {
    button.setAttribute("aria-pressed", String(as.pressed));
    button.append(tick("pt__check"));
  }
  return button;
}

export function addPrinterTile(): HTMLButtonElement {
  const button = el(
    "button",
    "pt pt--add",
    el("span", "pt__art", icon(ICONS.plus)),
    el("span", "pt__model", "Add printer"),
  );
  button.type = "button";
  return button;
}
