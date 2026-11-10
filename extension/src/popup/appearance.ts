// The Appearance tab: how the floating bubble on model pages looks, and which corner it sits in. A pick is saved at
// once, and pages already open follow it there and then (content/index.ts). Each choice is a radio, in a group of
// its own: one tab stop per group, the arrow keys moving within it.

import {
  BUBBLE_PLACES,
  BUBBLE_STYLES,
  DEFAULT_BUBBLE,
  type BubbleLook,
  type BubblePlace,
  type BubbleStyle,
} from "../shared/bubble";
import { createIcon } from "../shared/icon";
import { send } from "../shared/messages";
import { clearError, els, showError } from "./dom";

const STYLE_NAMES: Record<BubbleStyle, string> = {
  bubble: "Bubble",
  pill: "Pill",
  mini: "Mini",
  brand: "Brand",
  glass: "Glass",
  edge: "Edge tab",
};

const PLACE_NAMES: Record<BubblePlace, string> = {
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
};

let current: BubbleLook = DEFAULT_BUBBLE;

const span = (className: string, ...children: (Node | string)[]): HTMLSpanElement => {
  const el = document.createElement("span");
  el.className = className;
  el.append(...children);
  return el;
};

/** A page, drawn small: a picture and a few lines, for a bubble to sit over. */
const pageSketch = (className: string): HTMLSpanElement =>
  span(className, span(`${className}-pic`), span(`${className}-line`), span(`${className}-line`));

/** The bubble in `style`, drawn with the page's own stylesheet (styles/_bubble-looks.scss): looked at, not used. */
function bubblePreview(): HTMLSpanElement {
  const word = span("tg-fab__label", "Grab");
  return span("tg-fab", span("tg-fab__body", span("tg-fab__blob"), span("tg-fab__mark", createIcon()), word));
}

function radio(className: string, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("role", "radio");
  btn.setAttribute("aria-checked", "false");
  btn.title = label;
  return btn;
}

const defaultChip = (): HTMLSpanElement => span("chip", "Default");

function styleTile(style: BubbleStyle): HTMLButtonElement {
  const btn = radio("look", STYLE_NAMES[style]);
  btn.dataset.value = style;
  const swatch = span("look__swatch", pageSketch("look__page"), bubblePreview());
  swatch.dataset.style = style;
  swatch.setAttribute("aria-hidden", "true");
  const name = span("look__name", STYLE_NAMES[style]);
  if (style === DEFAULT_BUBBLE.style) name.append(defaultChip());
  btn.append(swatch, name);
  btn.addEventListener("click", () => void choose({ style }));
  return btn;
}

function placeSpot(place: BubblePlace): HTMLButtonElement {
  const btn = radio(`spots__spot spots__spot--${place}`, PLACE_NAMES[place]);
  btn.dataset.value = place;
  btn.setAttribute("aria-label", PLACE_NAMES[place]);
  btn.append(span("spots__mark", createIcon()));
  btn.addEventListener("click", () => void choose({ place }));
  return btn;
}

/** Arrow keys, Home and End move the pick within a group, as in any radio group. */
function arrowKeys(group: HTMLElement, pick: (value: string) => void): void {
  group.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const at = radios.findIndex((r) => r.getAttribute("aria-checked") === "true");
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? radios.length - 1
          : (Math.max(at, 0) + step + radios.length) % radios.length;
    pick(radios[next].dataset.value!);
    radios[next].focus();
  });
}

/** Marks the group's choice, and makes it the one tab stop. */
function check(group: HTMLElement, value: string): void {
  for (const r of group.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
    const on = r.dataset.value === value;
    r.setAttribute("aria-checked", String(on));
    r.tabIndex = on ? 0 : -1;
  }
}

function render(): void {
  check(els.bubbleStyles, current.style);
  check(els.bubblePlaces, current.place);
  els.bubblePlaceName.replaceChildren(PLACE_NAMES[current.place]);
  if (current.place === DEFAULT_BUBBLE.place) els.bubblePlaceName.append(defaultChip());
}

/** Shown at once, and put back if it can't be saved. */
async function choose(pick: Partial<BubbleLook>): Promise<void> {
  const before = current;
  current = { ...current, ...pick };
  if (current.style === before.style && current.place === before.place) return;
  clearError(els.appearanceError);
  render();
  const res = await send("SET_BUBBLE", pick);
  if (res?.ok) return;
  current = before;
  render();
  showError(res?.error ?? "Couldn't save", els.appearanceError);
}

/** The look stored, as the background said. */
export function showAppearance(look: BubbleLook): void {
  current = look;
  render();
}

els.bubbleStyles.append(...BUBBLE_STYLES.map(styleTile));
els.bubblePlaces.append(pageSketch("spots__page"), ...BUBBLE_PLACES.map(placeSpot));
arrowKeys(els.bubbleStyles, (style) => void choose({ style: style as BubbleStyle }));
arrowKeys(els.bubblePlaces, (place) => void choose({ place: place as BubblePlace }));
render();
