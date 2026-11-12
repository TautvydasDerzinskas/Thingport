// Download adapted on the site's own page. Beside its main open or download button, an outlined button, so the
// site's own stays the main action, naming under its label the copy a click makes (the last one made, else the first)
// and, where the model has several 3MFs, which file; its ▾ picks another file or copy, or opens Grab's settings. Where
// the site lists each file with buttons of its own (Printables' Files tab), every 3MF there gets a small "Adapted"
// button too, whose menu downloads that file's copies. Each is in a shadow root of its own, so it sits in the page's
// layout without sharing styles either way; the site (site.ts) says where they go and which theme they show.

import { DEFAULT_TARGET, pickTarget, targetLine, targetName, type AdaptTarget } from "../../shared/adaptTargets";
import { createIcon } from "../../shared/icon";
import { send } from "../../shared/messages";
import css from "../styles/adapted.scss?inline";
import { downloadAdapted } from "./download";
import { explanation, savedNote } from "./offer";
import { ICONS, element, placeFixed, shownName, sizeText, svg, targetPicture } from "./popover";
import type { AdaptFile, PageAdapt } from "./site";

const HOST_ID = "thingport-grab-adapted";
const LABEL = "Download adapted";
const DONE_RESET_MS = 3000;
const NOTE_SHOW_MS = 10000;
// How long the site's own button may take to show before the copies are offered in Grab's bubble instead.
const ANCHOR_WAIT_MS = 8000;

/** What the page's buttons share: the page, the file and copy picked, and whether a copy is being made. */
type Shared = PageAdapt & {
  pageUrl: string;
  file: AdaptFile;
  target: AdaptTarget;
  busy: boolean;
  /** Run whenever any of it changes. */
  watchers: Set<() => void>;
};

const changed = (shared: Shared) => shared.watchers.forEach((watch) => watch());

function shadowHost(shared: Shared): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement("span");
  host.dataset.site = shared.site.id;
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style);
  return { host, root };
}

// ---- The explanation, and what was saved or went wrong --------------------------------------------------------

type Bubble = {
  show(message: string, options?: { error?: boolean; hold?: number }): void;
  hide(): void;
  /** Showing something until its time is up, rather than for as long as it's pointed at. */
  held(): boolean;
};

/** Fixed, so an ancestor's overflow can't clip it: under `near`, or above it where there's no room below (a
 *  bottom-stuck action bar), from its left edge or, `alignEnd`, its right. */
function bubbleFor(root: ShadowRoot, near: HTMLElement, id: string, alignEnd = false): Bubble {
  const bubble = element("div", "nd-bubble");
  bubble.id = id;
  bubble.hidden = true;
  root.append(bubble);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holding = false;
  const hide = () => {
    clearTimeout(timer);
    holding = false;
    bubble.hidden = true;
  };
  return {
    show(message, { error = false, hold = 0 } = {}) {
      clearTimeout(timer);
      holding = hold > 0;
      bubble.textContent = message;
      bubble.setAttribute("role", error ? "alert" : "tooltip");
      bubble.classList.toggle("nd-bubble--error", error);
      bubble.hidden = false;
      const rect = near.getBoundingClientRect();
      const from = alignEnd ? rect.right - bubble.offsetWidth : rect.left;
      const below = rect.bottom + 8 + bubble.offsetHeight <= window.innerHeight;
      placeFixed(
        bubble,
        Math.min(Math.max(8, from), window.innerWidth - bubble.offsetWidth - 8),
        below ? rect.bottom + 8 : Math.max(8, rect.top - 8 - bubble.offsetHeight),
      );
      if (holding) timer = setTimeout(hide, hold);
    },
    hide,
    held: () => holding,
  };
}

// ---- Menus ----------------------------------------------------------------------------------------------------

type Menu = { open(): void; close(refocus: boolean): void; isOpen(): boolean; stop(): void };

/** A menu `trigger` opens under `near` (above where there's no room), filled afresh each time. Arrow keys, Home and
 *  End move through it, Escape closes it, and so does a click elsewhere. It follows `near` as the page scrolls, and
 *  closes once that's out of the window. */
function menuFor(
  host: HTMLElement,
  root: ShadowRoot,
  trigger: HTMLButtonElement,
  near: HTMLElement,
  label: string,
  fill: () => Node[],
  alignEnd = true,
): Menu {
  const menu = element("div", "ndm");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.hidden = true;
  root.append(menu);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const items = () => [...menu.querySelectorAll<HTMLButtonElement>("button")];
  const position = () => {
    const rect = near.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(rect.width, 240)}px`;
    const room = { below: window.innerHeight - rect.bottom - 14, above: rect.top - 14 };
    const down = room.below >= Math.min(menu.scrollHeight, 320) || room.below >= room.above;
    menu.style.maxHeight = `${Math.max(120, down ? room.below : room.above)}px`;
    const from = alignEnd ? rect.right - menu.offsetWidth : rect.left;
    placeFixed(
      menu,
      Math.max(8, Math.min(from, window.innerWidth - menu.offsetWidth - 8)),
      down ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menu.offsetHeight),
    );
  };
  const onOutside = (event: Event) => {
    if (!event.composedPath().includes(host)) close(false);
  };
  let frame = 0;
  // Its own list scrolling, where it's long, isn't the page's.
  const onScroll = (event: Event) => {
    if (event.composedPath().includes(menu)) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = near.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) close(false);
      else position();
    });
  };
  function close(refocus: boolean): void {
    if (menu.hidden) return;
    menu.hidden = true;
    cancelAnimationFrame(frame);
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("scroll", onScroll, true);
    if (refocus) trigger.focus();
  }
  function open(): void {
    menu.replaceChildren(...fill());
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position();
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onScroll, true);
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
  }
  trigger.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && menu.hidden) {
      event.preventDefault();
      open();
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
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") close(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  });
  return { open, close, isOpen: () => !menu.hidden, stop: () => close(false) };
}

function menuRow(className: string, role: string, checked?: boolean): HTMLButtonElement {
  const row = element("button", `ndm__row ${className}`);
  row.type = "button";
  row.tabIndex = -1;
  row.setAttribute("role", role);
  if (checked !== undefined) row.setAttribute("aria-checked", String(checked));
  return row;
}

function rowText(name: string, sub: string): HTMLElement {
  const text = element("span", "ndm__text");
  text.append(element("span", "ndm__name", name));
  if (sub) text.append(element("span", "ndm__sub", sub));
  return text;
}

function tick(): HTMLElement {
  const box = element("span", "ndm__tick");
  box.append(svg(ICONS.check));
  return box;
}

/** A labelled part of a menu. */
function menuGroup(id: string, label: string, rows: HTMLElement[]): HTMLElement {
  const group = element("div", "ndm__group");
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", id);
  const heading = element("div", "ndm__label", label);
  heading.id = id;
  group.append(heading, ...rows);
  return group;
}

function separator(): HTMLElement {
  const sep = element("div", "ndm__sep");
  sep.setAttribute("role", "separator");
  return sep;
}

/** A row per copy, the picked one ticked: a click picks it, remembers it as the last one made, and makes it. */
function copyRows(shared: Shared, make: (target: AdaptTarget) => void): HTMLElement[] {
  return shared.targets.map((target) => {
    const row = menuRow("", "menuitemradio", target.key === shared.target.key);
    const { name, sub } = targetName(target);
    row.title = explanation(shared.site, target);
    row.append(targetPicture(target, "ndm__art"), rowText(name, sub), tick());
    row.addEventListener("click", () => {
      shared.target = target;
      changed(shared);
      void send("SET_ADAPT_LAST", { key: target.key });
      make(target);
    });
    return row;
  });
}

function settingsRow(shared: Shared, closeMenu: () => void): HTMLElement {
  const row = menuRow("ndm__row--settings", "menuitem");
  const gear = element("span", "ndm__art ndm__art--glyph");
  gear.append(svg(ICONS.gear));
  // Nothing picked yet: the one thing to do is pick a slicer.
  const unpicked = shared.targets.length === 1 && shared.targets[0] === DEFAULT_TARGET;
  row.append(gear, rowText(unpicked ? "Pick your slicer…" : "Adapt settings…", ""));
  row.addEventListener("click", () => {
    closeMenu();
    void send("OPEN_ADAPT_SETTINGS");
  });
  return row;
}

// ---- Making a copy ----------------------------------------------------------------------------------------------

type RunView = {
  progress(text: string): void;
  /** Saved, with what's worth saying about it, if anything. */
  done(note: string | null): void;
  failed(message: string): void;
  /** Back to how it was, whether it worked or not. */
  reset(): void;
};

/** Where focus goes back to once a copy is made: `returnTo`, where it was in the control (`hadFocus`, read before its
 *  menu closed) and has been lost since, as the menu closed and the buttons waited, rather than put somewhere else. */
type FocusReturn = { host: HTMLElement; returnTo: HTMLElement; hadFocus: boolean };

const hasFocus = (host: HTMLElement) => document.activeElement === host;

/** One copy at a time on the page: every button waits while one is being made. */
async function makeCopy(
  shared: Shared,
  file: AdaptFile,
  target: AdaptTarget,
  view: RunView,
  focus: FocusReturn,
): Promise<void> {
  shared.busy = true;
  changed(shared);
  try {
    const saved = await downloadAdapted(shared.site, shared.pageUrl, file, target, view.progress);
    view.done(savedNote(target, saved));
    await new Promise((resolve) => setTimeout(resolve, DONE_RESET_MS));
  } catch (err) {
    view.failed(err instanceof Error ? err.message : String(err));
  } finally {
    shared.busy = false;
    changed(shared);
    view.reset();
    const now = document.activeElement;
    const lost = !now || now === document.body || (now === focus.host && !focus.host.shadowRoot?.activeElement);
    if (focus.hadFocus && lost) focus.returnTo.focus();
  }
}

// ---- Beside the site's own button ------------------------------------------------------------------------------

type Control = { host: HTMLElement; stop(): void };

function mainButton(shared: Shared): Control {
  const { host, root } = shadowHost(shared);
  host.id = HOST_ID;
  // A site whose page picks the file itself (a print profile chosen on it) gets that one's copy, as it is when asked;
  // elsewhere, the menu offers the files where there are several.
  const { selected } = shared.site;
  const several = !selected && shared.files.length > 1;
  const current = () => (selected ? (selected(shared.files) ?? shared.files[0]) : shared.file);

  const split = element("span", "nd-split");
  const main = element("button", "nd nd__main");
  main.type = "button";
  main.setAttribute("aria-describedby", "tg-nd-info");
  const logo = element("span", "nd__logo");
  logo.append(createIcon());
  const text = element("span", "nd__text");
  const title = element("span", "nd__title", LABEL);
  const line = element("span", "nd__line");
  const fileLine = element("span", "nd__file");
  const targetLineEl = element("span", "nd__target");
  line.append(...(several ? [fileLine, element("span", "nd__dot", " · ")] : []), targetLineEl);
  text.append(title, line);
  const info = element("span", "nd__info");
  info.append(svg(ICONS.bulb));
  main.append(logo, text, info);
  const more = element("button", "nd nd__more");
  more.type = "button";
  more.setAttribute(
    "aria-label",
    several
      ? "Choose the file and the copy, or Grab's settings for them"
      : "Choose the copy, or Grab's settings for it",
  );
  more.append(svg(ICONS.caret));
  split.append(main, more);
  root.append(split);
  const bubble = bubbleFor(root, split, "tg-nd-info");

  const show = () => {
    fileLine.textContent = shownName(shared.file);
    targetLineEl.textContent = targetLine(shared.target);
    const what = several ? `${shownName(shared.file)}, ${targetLine(shared.target)}` : targetLine(shared.target);
    main.setAttribute("aria-label", `${LABEL}: ${what}`);
    main.disabled = shared.busy;
    more.disabled = shared.busy;
  };
  shared.watchers.add(show);
  show();

  const showInfo = () => {
    if (!bubble.held()) bubble.show(explanation(shared.site, shared.target));
  };
  info.addEventListener("mouseenter", showInfo);
  info.addEventListener("mouseleave", () => !bubble.held() && bubble.hide());
  main.addEventListener("focus", () => main.matches(":focus-visible") && showInfo());
  main.addEventListener("blur", () => !bubble.held() && bubble.hide());

  const make = (target: AdaptTarget, returnTo: HTMLElement) => {
    if (shared.busy) return;
    const hadFocus = hasFocus(host);
    menu.close(false);
    bubble.hide();
    info.replaceChildren(element("span", "nd__spinner"));
    void makeCopy(
      shared,
      current(),
      target,
      {
        progress: (status) => (title.textContent = status),
        done: (note) => {
          title.textContent = "Downloaded";
          info.replaceChildren(svg(ICONS.check));
          if (note) bubble.show(note, { hold: NOTE_SHOW_MS });
        },
        failed: (message) => bubble.show(message, { error: true, hold: NOTE_SHOW_MS }),
        reset: () => {
          info.replaceChildren(svg(ICONS.bulb));
          title.textContent = LABEL;
        },
      },
      { host, returnTo, hadFocus },
    );
  };
  main.addEventListener("click", () => make(shared.target, main));

  const fileRows = () =>
    shared.files.map((file) => {
      const row = menuRow("ndm__row--file", "menuitemradio", file === shared.file);
      row.append(rowText(shownName(file), sizeText(file.size)), tick());
      // Picks the file and leaves the menu open, for the copy to be picked next.
      row.addEventListener("click", () => {
        shared.file = file;
        changed(shared);
        for (const other of row.parentElement!.querySelectorAll("[role=menuitemradio]")) {
          other.setAttribute("aria-checked", String(other === row));
        }
      });
      return row;
    });
  const copies = () => copyRows(shared, (target) => make(target, more));
  const menu = menuFor(host, root, more, split, several ? "Files and copies to download" : "Copies to download", () => [
    ...(several
      ? [
          menuGroup("tg-ndm-files", "3MF file", fileRows()),
          separator(),
          menuGroup("tg-ndm-copies", "Copy for", copies()),
        ]
      : selected
        ? [menuGroup("tg-ndm-copies", `Copy of ${shownName(current())}`, copies())]
        : copies()),
    separator(),
    settingsRow(shared, () => menu.close(false)),
  ]);
  more.addEventListener("click", () => bubble.hide());

  return {
    host,
    stop: () => {
      shared.watchers.delete(show);
      menu.stop();
      bubble.hide();
    },
  };
}

// ---- In a file's own row ---------------------------------------------------------------------------------------

function rowButton(shared: Shared, file: AdaptFile): Control {
  const { host, root } = shadowHost(shared);
  host.dataset.row = "";
  const button = element("button", "ndr");
  button.type = "button";
  button.setAttribute("aria-label", `Download ${shownName(file)} adapted`);
  const logo = element("span", "ndr__logo");
  logo.append(createIcon());
  const end = element("span", "ndr__end");
  end.append(svg(ICONS.caret));
  button.append(logo, element("span", "ndr__label", "Adapted"), end);
  root.append(button);
  const bubble = bubbleFor(root, button, "tg-ndr-status", true);

  const sync = () => (button.disabled = shared.busy);
  shared.watchers.add(sync);
  sync();

  const make = (target: AdaptTarget) => {
    if (shared.busy) return;
    const hadFocus = hasFocus(host);
    menu.close(false);
    end.replaceChildren(element("span", "nd__spinner"));
    void makeCopy(
      shared,
      file,
      target,
      {
        progress: (status) => bubble.show(status),
        done: (note) => {
          end.replaceChildren(svg(ICONS.check));
          bubble.show(note ?? "Downloaded", { hold: note ? NOTE_SHOW_MS : DONE_RESET_MS });
        },
        failed: (message) => bubble.show(message, { error: true, hold: NOTE_SHOW_MS }),
        reset: () => end.replaceChildren(svg(ICONS.caret)),
      },
      { host, returnTo: button, hadFocus },
    );
  };
  const menu = menuFor(host, root, button, button, `Adapted copies of ${shownName(file)}`, () => [
    menuGroup("tg-ndr-copies", LABEL, copyRows(shared, make)),
    separator(),
    settingsRow(shared, () => menu.close(false)),
  ]);
  button.addEventListener("click", () => bubble.hide());

  return {
    host,
    stop: () => {
      shared.watchers.delete(sync);
      menu.stop();
      bubble.hide();
    },
  };
}

// ---- Keeping them in place as the page re-renders --------------------------------------------------------------

let mounted: { stop: () => void } | null = null;

export function unmountAdaptedButton(): void {
  mounted?.stop();
  mounted = null;
}

/**
 * Puts the button beside the site's own, and one in each 3MF's row where the site lists them, keeping them there as
 * the page re-renders. `onNoAnchor` runs where the site's button hasn't shown in ANCHOR_WAIT_MS, or went away and
 * hasn't come back in that time, to offer the copies somewhere else, and says whether it did: then the button beside
 * the site's isn't put there any more, so the site's button showing later doesn't bring a second offer. The rows'
 * buttons stay.
 */
export function mountAdaptedButton(page: PageAdapt, pageUrl: string, onNoAnchor: () => boolean): void {
  unmountAdaptedButton();
  const { site } = page;
  const shared: Shared = {
    ...page,
    pageUrl,
    file: page.files[0],
    target: pickTarget(page.targets, page.offer.lastKey) ?? DEFAULT_TARGET,
    busy: false,
    watchers: new Set(),
  };
  const main = mainButton(shared);
  const rows = new Map<HTMLElement, Control>();
  const theme = () => {
    const dark = site.dark();
    for (const control of [main, ...rows.values()]) control.host.toggleAttribute("data-dark", dark);
  };

  let anchor: HTMLElement | null = null;
  // Offered somewhere else, as the site's button didn't show in time.
  let elsewhere = false;
  // Beside the site's button now: its going away starts the wait again.
  let beside = false;
  // The wait for the site's button, ANCHOR_WAIT_MS whole each time: from the start, until it's there, and again
  // whenever it goes away.
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const offerElsewhere = () => {
    waiting = undefined;
    if (!elsewhere && !main.host.isConnected && !site.unavailable?.() && onNoAnchor()) elsewhere = true;
  };
  const wait = () => {
    waiting ??= setTimeout(offerElsewhere, ANCHOR_WAIT_MS);
  };
  const place = () => {
    if (!elsewhere && !(main.host.isConnected && anchor?.isConnected && anchor.offsetParent !== null)) {
      anchor = site.anchor();
      if (anchor) {
        site.place(main.host, anchor);
        beside = true;
        clearTimeout(waiting);
        waiting = undefined;
      } else {
        // Gone, alone or with what held both, maybe only while the page redraws: elsewhere, should it not come back in
        // time.
        if (beside) wait();
        beside = false;
        main.host.remove();
      }
    }
    if (!site.fileRows || !site.placeInRow) return;
    const shown = new Set<HTMLElement>();
    for (const row of site.fileRows(page.files)) {
      shown.add(row.anchor);
      let control = rows.get(row.anchor);
      if (!control) {
        control = rowButton(shared, row.file);
        control.host.toggleAttribute("data-dark", site.dark());
        rows.set(row.anchor, control);
      }
      if (!control.host.isConnected) site.placeInRow(control.host, row.anchor);
    }
    for (const [rowAnchor, control] of rows) {
      if (shown.has(rowAnchor)) continue;
      control.stop();
      control.host.remove();
      rows.delete(rowAnchor);
    }
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
  const themeObserver = new MutationObserver(theme);
  const watched = site.themeWatch();
  themeObserver.observe(watched.target, { attributes: true, attributeFilter: watched.attributeFilter });
  const system = matchMedia("(prefers-color-scheme: dark)");
  system.addEventListener("change", theme);
  theme();
  place();
  if (!beside) wait();

  mounted = {
    stop: () => {
      observer.disconnect();
      themeObserver.disconnect();
      system.removeEventListener("change", theme);
      clearTimeout(waiting);
      for (const control of [main, ...rows.values()]) {
        control.stop();
        control.host.remove();
      }
    },
  };
}
