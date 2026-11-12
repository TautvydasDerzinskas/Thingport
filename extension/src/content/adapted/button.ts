// Download adapted beside the site's own open or download button: an outlined button, so the site's own stays the
// main action, that names under its label the copy a click makes (the last one made, else the first), with a ▾ for
// the other copies and Grab's settings. Its own shadow root, so it sits in the page's layout without sharing styles
// either way; the site (site.ts) says where it goes and which theme it shows.

import { slicerMark } from "../../adapter/slicers/marks.generated";
import { DEFAULT_TARGET, pickTarget, targetLine, targetName, type AdaptTarget } from "../../shared/adaptTargets";
import { createIcon } from "../../shared/icon";
import { send } from "../../shared/messages";
import { printerArtSvg } from "../../shared/printerArt";
import css from "../styles/adapted.scss?inline";
import { downloadAdapted } from "./download";
import { explanation } from "./offer";
import type { AdaptSite } from "./site";

const HOST_ID = "thingport-grab-adapted";
const LABEL = "Download adapted";
const DONE_RESET_MS = 3000;
const ERROR_SHOW_MS = 10000;
// How long the site's own button may take to show before the copies are offered in Grab's bubble instead.
const ANCHOR_WAIT_MS = 8000;

const SVG = {
  // Material Design "Lightbulb" (Apache 2.0), the web app's icon for the same option.
  bulb: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7"/></svg>',
  caret:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10l5 5 5-5z"/></svg>',
  check:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  gear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

/** Markup made in this file only, from numbers and fixed paths: parsed as SVG, never as page HTML. */
function svg(markup: string): Element {
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

type Mounted = { host: HTMLElement; stop: () => void };
let mounted: Mounted | null = null;

export function unmountAdaptedButton(): void {
  mounted?.stop();
  mounted?.host.remove();
  mounted = null;
}

/**
 * Puts the button beside the site's own, keeping it there as the page re-renders. `targets` are the copies the site's
 * files get, at least one; `lastKey` the copy made last. `onNoAnchor` runs once if the site's button hasn't shown in
 * ANCHOR_WAIT_MS, to offer the copies somewhere else.
 */
export function mountAdaptedButton(
  site: AdaptSite,
  pageUrl: string,
  targets: AdaptTarget[],
  lastKey: string | null,
  onNoAnchor: () => void,
): void {
  unmountAdaptedButton();
  let current = pickTarget(targets, lastKey) ?? DEFAULT_TARGET;

  const host = document.createElement("span");
  host.id = HOST_ID;
  host.dataset.site = site.id;
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;

  const split = element("span", "nd-split");
  const main = element("button", "nd nd__main");
  main.type = "button";
  main.setAttribute("aria-describedby", "tg-nd-info");
  const logo = element("span", "nd__logo");
  logo.append(createIcon());
  const text = element("span", "nd__text");
  const title = element("span", "nd__title");
  title.textContent = LABEL;
  const line = element("span", "nd__line");
  text.append(title, line);
  const info = element("span", "nd__info");
  info.append(svg(SVG.bulb));
  main.append(logo, text, info);
  const more = element("button", "nd nd__more");
  more.type = "button";
  more.setAttribute("aria-label", "Choose the copy, or Grab's settings for them");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  more.append(svg(SVG.caret));
  split.append(main, more);

  const menu = element("div", "ndm");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Copies to download");
  menu.hidden = true;
  const bubble = element("div", "nd-bubble");
  bubble.id = "tg-nd-info";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  root.append(style, split, menu, bubble);

  const show = () => {
    line.textContent = targetLine(current);
    main.setAttribute("aria-label", `${LABEL}: ${targetLine(current)}`);
  };
  show();

  // ---- The explanation, and what was saved or went wrong ------------------------------------------------------
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  const hideBubble = () => {
    clearTimeout(bubbleTimer);
    held = false;
    bubble.hidden = true;
  };
  const showBubble = (message: string, { error = false, note = false } = {}) => {
    clearTimeout(bubbleTimer);
    held = error || note;
    bubble.textContent = message;
    bubble.classList.toggle("nd-bubble--error", error);
    bubble.hidden = false;
    // Fixed, so an ancestor's overflow can't clip it.
    const rect = split.getBoundingClientRect();
    bubble.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - bubble.offsetWidth - 8)}px`;
    // Above when there's no room below, e.g. in a bottom-stuck action bar.
    const below = rect.bottom + 8 + bubble.offsetHeight <= window.innerHeight;
    bubble.style.top = `${below ? rect.bottom + 8 : Math.max(8, rect.top - 8 - bubble.offsetHeight)}px`;
    if (held) bubbleTimer = setTimeout(hideBubble, ERROR_SHOW_MS);
  };
  const showInfo = () => {
    if (bubble.hidden) showBubble(explanation(site, current));
  };
  info.addEventListener("mouseenter", showInfo);
  info.addEventListener("mouseleave", () => !held && hideBubble());
  main.addEventListener("focus", () => main.matches(":focus-visible") && showInfo());
  main.addEventListener("blur", () => !held && hideBubble());

  // ---- Downloading ----------------------------------------------------------------------------------------------
  let busy = false;
  const run = async (target: AdaptTarget) => {
    if (busy) return;
    busy = true;
    closeMenu(false);
    hideBubble();
    main.disabled = true;
    more.disabled = true;
    info.replaceChildren(element("span", "nd__spinner"));
    try {
      const saved = await downloadAdapted(site, pageUrl, target, (status) => (title.textContent = status));
      title.textContent = "Downloaded";
      const name = target.printer ? `${target.printer.brandName} ${target.printer.model}` : null;
      if (!saved.copy) showBubble("Your slicer opens this file as it is, so this is the file itself.", { note: true });
      else if (saved.printerless && name) {
        showBubble(`Grab has no ${targetName(target).sub} preset for the ${name}, so this copy keeps your own.`, {
          note: true,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, DONE_RESET_MS));
    } catch (err) {
      showBubble(err instanceof Error ? err.message : String(err), { error: true });
    } finally {
      busy = false;
      main.disabled = false;
      more.disabled = false;
      info.replaceChildren(svg(SVG.bulb));
      title.textContent = LABEL;
    }
  };
  main.addEventListener("click", () => void run(current));

  // ---- The menu -------------------------------------------------------------------------------------------------
  const items = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>("button")];
  const onOutside = (event: Event) => {
    if (!event.composedPath().includes(host)) closeMenu(false);
  };
  function closeMenu(refocus: boolean): void {
    if (menu.hidden) return;
    menu.hidden = true;
    more.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("scroll", onScroll, true);
    if (refocus) more.focus();
  }
  const onScroll = () => closeMenu(false);
  function fillMenu(): void {
    const rows = targets.map((target) => {
      const row = element("button", "ndm__row");
      row.type = "button";
      row.tabIndex = -1;
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("aria-checked", String(target.key === current.key));
      const { name, sub } = targetName(target);
      const label = element("span", "ndm__text");
      const nameEl = element("span", "ndm__name");
      nameEl.textContent = name;
      const subEl = element("span", "ndm__sub");
      subEl.textContent = sub;
      label.append(nameEl, subEl);
      const tick = element("span", "ndm__tick");
      tick.append(svg(SVG.check));
      row.append(targetPicture(target, "ndm__art"), label, tick);
      row.addEventListener("click", () => {
        current = target;
        show();
        void send("SET_ADAPT_LAST", { key: target.key });
        void run(target);
      });
      return row;
    });
    const settings = element("button", "ndm__row ndm__row--settings");
    settings.type = "button";
    settings.tabIndex = -1;
    settings.setAttribute("role", "menuitem");
    const gear = element("span", "ndm__art ndm__art--glyph");
    gear.append(svg(SVG.gear));
    const label = element("span", "ndm__text");
    const nameEl = element("span", "ndm__name");
    // Nothing picked yet: the one thing to do is pick a slicer.
    nameEl.textContent =
      targets.length === 1 && targets[0] === DEFAULT_TARGET ? "Pick your slicer…" : "Adapt settings…";
    label.append(nameEl);
    settings.append(gear, label);
    settings.addEventListener("click", () => {
      closeMenu(false);
      void send("OPEN_ADAPT_SETTINGS");
    });
    const sep = element("div", "ndm__sep");
    sep.setAttribute("role", "separator");
    menu.replaceChildren(...rows, sep, settings);
  }
  function openMenu(): void {
    hideBubble();
    fillMenu();
    menu.hidden = false;
    more.setAttribute("aria-expanded", "true");
    // Fixed, under the button, inside the window.
    const rect = split.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(rect.width, 240)}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    const below = rect.bottom + 6 + menu.offsetHeight <= window.innerHeight;
    menu.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menu.offsetHeight)}px`;
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onScroll, true);
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
  }
  more.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu(true)));
  more.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && menu.hidden) {
      event.preventDefault();
      openMenu();
    }
  });
  menu.addEventListener("keydown", (event) => {
    const list = items();
    const at = list.indexOf(root.activeElement as HTMLButtonElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") closeMenu(true);
    else if (event.key === "Tab") closeMenu(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  });

  // ---- Staying beside the site's button --------------------------------------------------------------------------
  let anchor: HTMLElement | null = null;
  let placed = false;
  const place = () => {
    if (
      host.isConnected &&
      anchor?.isConnected &&
      anchor.offsetParent !== null &&
      host.previousElementSibling === anchor
    )
      return;
    anchor = site.anchor();
    if (!anchor) {
      host.remove();
      return;
    }
    site.place(host, anchor);
    placed = true;
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      place();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  const syncTheme = () => host.toggleAttribute("data-dark", site.dark());
  const themeObserver = new MutationObserver(syncTheme);
  const watched = site.themeWatch();
  themeObserver.observe(watched.target, { attributes: true, attributeFilter: watched.attributeFilter });
  syncTheme();
  place();
  const waited = setTimeout(() => {
    if (!placed) onNoAnchor();
  }, ANCHOR_WAIT_MS);

  mounted = {
    host,
    stop: () => {
      observer.disconnect();
      themeObserver.disconnect();
      clearTimeout(waited);
      clearTimeout(bubbleTimer);
      closeMenu(false);
    },
  };
}
