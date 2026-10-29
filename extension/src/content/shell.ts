// Shadow-rooted host for all in-page UI, isolated from the provider page's styles.

import { createIcon } from "../shared/icon";
import { send } from "../shared/messages";
import { dressMark } from "../shared/seasonalMark";
import { attachMagnet } from "./magnet";
import css from "./styles/content.scss?inline";

const HOST_ID = "thingport-grab-host";

let shadowRoot: ShadowRoot | null = null;
let stackEl: HTMLDivElement | null = null;
let fabBodyEl: HTMLElement | null = null;
let panelEl: HTMLDivElement | null = null;
let contentEl: HTMLDivElement | null = null;
let noteEl: HTMLDivElement | null = null;

export function mountHost(): ShadowRoot {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadowRoot.appendChild(style);
  return shadowRoot;
}

export function getShadowRoot(): ShadowRoot | null {
  return shadowRoot;
}

export function unmountHost(): void {
  document.getElementById(HOST_ID)?.remove();
  shadowRoot = null;
  stackEl = null;
  fabBodyEl = null;
  panelOpen = false;
  window.clearTimeout(closeTimer);
  panelEl = null;
  contentEl = null;
  noteEl = null;
}

type FabOptions = {
  variant?: "in-library" | "inactive" | "disconnected";
  label: string;
  title?: string;
  onClick: () => void;
};

export function mountFab(root: ShadowRoot, { variant, label, title, onClick }: FabOptions): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant ? `tg-fab tg-fab--${variant}` : "tg-fab";
  button.setAttribute("aria-label", label);
  if (title) button.title = title;
  // The button stays put as the hit area; its body leans toward the pointer (see magnet.ts), the blob behind the
  // icon stretching as it goes.
  const body = document.createElement("span");
  body.className = "tg-fab__body";
  const blob = document.createElement("span");
  blob.className = "tg-fab__blob";
  // The icon and, on its days, its seasonal edition over it (see shared/seasonalMark.ts).
  const mark = document.createElement("span");
  mark.className = "tg-fab__mark";
  mark.append(createIcon());
  body.append(blob, mark);
  void send("GET_SEASONAL_ICON").then(
    (res) => {
      if (res?.ok) dressMark(mark, res.data, "tg-fab__season");
    },
    () => undefined,
  );
  button.appendChild(body);
  fabBodyEl = body;
  button.addEventListener("click", onClick);
  root.appendChild(button);
  attachMagnet(button, body, {
    // The stack, not the panel: the panel itself is never hidden, its column is (see mountPanel).
    paused: () => Boolean(stackEl && !stackEl.hidden),
    dodges: () => "dodge" in mark.dataset,
  });
}

/**
 * A tag beside the floating icon, for something about this page the icon itself can't say.
 *
 * Beside rather than on it: the icon is a button with a magnet effect and a seasonal mark of its own, and the
 * tag has to stay still to be read and pointed at. It sits to the icon's left, level with its middle, and is
 * only ever there when there is something to say.
 */
export function mountFabNote(root: ShadowRoot, html: string, tooltip: string): void {
  const note = document.createElement("div");
  note.className = "tg-fab-note";
  note.title = tooltip;
  note.innerHTML = html;
  root.appendChild(note);
}

/**
 * `onFirstOpen` runs once. Returns the toggle for the icon's click handler.
 *
 * The panel sits in a column anchored above the icon, so anything put over it -- a note about the model, from
 * setPanelNote -- stacks there and the pair grows upward together, whatever height the panel happens to be.
 */
export function mountPanel(root: ShadowRoot, onFirstOpen: () => void): () => void {
  const stack = document.createElement("div");
  stack.className = "tg-panel-stack";
  stack.hidden = true;

  const panel = document.createElement("div");
  panel.className = "tg-panel";

  // Outside contentEl so it survives re-renders.
  const closeBtn = document.createElement("button");
  closeBtn.className = "tg-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => setPanelOpen(false));
  panel.appendChild(closeBtn);

  const content = document.createElement("div");
  content.className = "tg-panel__content";
  panel.appendChild(content);
  stack.appendChild(panel);
  root.appendChild(stack);

  stackEl = stack;
  panelEl = panel;
  contentEl = content;
  let loaded = false;
  return () => {
    const open = !panelOpen;
    setPanelOpen(open);
    if (open && !loaded) {
      loaded = true;
      onFirstOpen();
    }
  };
}

// Long enough for tg-panel-suck to finish; the panel is only hidden once it has.
const CLOSE_MS = 200;

let panelOpen = false;
let closeTimer: number | undefined;

const stillMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The icon reacts to the panel coming out of it and going back in: it squashes as it lets go, and swells as it
 *  takes it back. A nudge to --tg-press rides the blob's own spring (see styles/_fab.scss), rather than animating
 *  its transform, which the magnet is already driving. */
function bumpFab(press: number): void {
  const body = fabBodyEl;
  if (!body || stillMotion()) return;
  body.style.setProperty("--tg-press", String(press));
  window.setTimeout(() => body.style.removeProperty("--tg-press"), 140);
}

/** The panel is spat out of the floating icon and sucked back into it, so it reads as the icon's own: the stack
 *  scales out of the icon's centre (styles/_panel.scss sets the origin there). */
export function setPanelOpen(open: boolean): void {
  const stack = stackEl;
  if (!stack || open === panelOpen) return;
  panelOpen = open;
  window.clearTimeout(closeTimer);
  stack.classList.remove("tg-panel-stack--opening", "tg-panel-stack--closing");
  if (open) {
    stack.hidden = false;
    // Reopened mid-close, the animation would otherwise carry on from where it was.
    void stack.offsetWidth;
    stack.classList.add("tg-panel-stack--opening");
    bumpFab(0.88);
    return;
  }
  if (stillMotion()) {
    stack.hidden = true;
    return;
  }
  void stack.offsetWidth;
  stack.classList.add("tg-panel-stack--closing");
  bumpFab(1.14);
  closeTimer = window.setTimeout(() => {
    stack.hidden = true;
    stack.classList.remove("tg-panel-stack--closing");
  }, CLOSE_MS);
}

/**
 * A small card of its own above the panel, for something true of this model rather than of the import: whether
 * the script it was generated from comes with it. Separate from the panel so it reads as a remark about what
 * is being imported, not as another of the panel's own rows. Null takes it away again.
 */
export function setPanelNote(html: string | null, tone?: "shared" | "withheld"): void {
  if (!stackEl) return;
  if (!html) {
    noteEl?.remove();
    noteEl = null;
    return;
  }
  if (!noteEl) {
    noteEl = document.createElement("div");
    // Before the panel in the column, which puts it above.
    noteEl.className = "tg-panel-note";
    stackEl.prepend(noteEl);
  }
  noteEl.className = tone ? `tg-panel-note tg-panel-note--${tone}` : "tg-panel-note";
  noteEl.innerHTML = html;
}

export function isPanelMounted(): boolean {
  return contentEl !== null;
}

export function renderPanel(html: string): void {
  // The panel may have been torn down mid-flow; the background work continues regardless.
  if (!contentEl) return;
  contentEl.innerHTML = html;
}

export function panelQuery<T extends Element = HTMLElement>(selector: string): T | null {
  return panelEl ? panelEl.querySelector<T>(selector) : null;
}

export function panelQueryAll<T extends Element = HTMLElement>(selector: string): T[] {
  return panelEl ? [...panelEl.querySelectorAll<T>(selector)] : [];
}

export function onPanelAction(action: string, handler: () => void): void {
  panelQuery(`[data-action="${action}"]`)?.addEventListener("click", handler);
}
