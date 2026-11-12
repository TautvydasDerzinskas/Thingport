// Download adapted in Grab's bubble: a row per copy (its printer or slicer, and what it's for), each downloading its
// copy on a click and saying on the row how it's going. Not set up for imports, the bubble's panel is these rows; set
// up, they open above a secondary "Download adapted" under the import, over the panel, as an extra beside it.

import { targetName, type AdaptTarget } from "../../shared/adaptTargets";
import { send } from "../../shared/messages";
import { pageHeadHtml } from "../panels/modelHead";
import { renderPanel, setPanelExtra, mountFab, mountPanel } from "../shell";
import type { ProviderId } from "../../providers/index.generated";
import { targetPicture } from "./button";
import { downloadAdapted } from "./download";
import { explanation } from "./offer";
import type { AdaptSite } from "./site";

const DOWNLOAD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
const DONE_RESET_MS = 3000;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const downloadIcon = () =>
  document.importNode(new DOMParser().parseFromString(DOWNLOAD_SVG, "image/svg+xml").documentElement, true);

/** A row per copy; `compact` for the rows under an import. */
export function adaptedRows(site: AdaptSite, pageUrl: string, targets: AdaptTarget[], compact = false): HTMLElement {
  const box = element("div", "ad");
  const list = element("div", `ad-list${compact ? " ad-list--compact" : ""}`);
  const error = element("div", "tg-hint ad-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  let busy = false;
  for (const target of targets) {
    const { name, sub } = targetName(target);
    const row = element("button", "ad-item");
    row.type = "button";
    row.title = explanation(site, target);
    const text = element("span", "ad-item__text");
    const subEl = element("span", "ad-item__sub", sub);
    text.append(element("span", "ad-item__name", name), subEl);
    const go = element("span", "ad-item__go");
    go.append(downloadIcon());
    row.append(targetPicture(target, "ad-item__art"), text, go);
    row.setAttribute("aria-label", `Download adapted: ${name}, ${sub}`);
    row.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      error.hidden = true;
      for (const other of list.querySelectorAll("button")) other.disabled = true;
      go.replaceChildren(element("span", "ad-item__spinner"));
      void send("SET_ADAPT_LAST", { key: target.key });
      try {
        const saved = await downloadAdapted(site, pageUrl, target, (status) => (subEl.textContent = status));
        subEl.textContent = saved.copy ? "Downloaded" : "Downloaded the file itself: your slicer opens it as it is";
        await new Promise((resolve) => setTimeout(resolve, DONE_RESET_MS));
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        error.hidden = false;
      } finally {
        busy = false;
        subEl.textContent = sub;
        go.replaceChildren(downloadIcon());
        for (const other of list.querySelectorAll("button")) other.disabled = false;
      }
    });
    list.append(row);
  }
  box.append(list, error);
  return box;
}

/** Set up for imports: under the import, a button as big as its own, in the quieter secondary style, whose copies open
 *  above it over the panel rather than growing it. Escape, a click elsewhere or the panel scrolling closes them. */
export function adaptedReveal(site: AdaptSite, pageUrl: string, targets: AdaptTarget[]): HTMLElement {
  const box = element("div", "ad-more");
  const toggle = element("button", "tg-btn tg-btn--secondary ad-reveal");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.append(downloadIcon(), element("span", "", "Download adapted"));
  const pop = element("div", "ad-pop");
  pop.id = "tg-adapted-copies";
  pop.setAttribute("role", "group");
  pop.setAttribute("aria-label", "Copies to download");
  pop.hidden = true;
  pop.append(adaptedRows(site, pageUrl, targets, true));
  toggle.setAttribute("aria-controls", pop.id);

  // Fixed, from the button's place in the window, so the panel's own scrolling can't clip it. A transformed ancestor
  // (the panel's opening animation leaves one) makes `fixed` count from that ancestor instead, so where it lands is
  // measured and the difference taken off.
  const place = () => {
    const rect = toggle.getBoundingClientRect();
    const bottom = window.innerHeight - rect.top + 6;
    pop.style.left = `${rect.left}px`;
    pop.style.bottom = `${bottom}px`;
    pop.style.width = `${rect.width}px`;
    pop.style.maxHeight = `${Math.max(120, rect.top - 16)}px`;
    const landed = pop.getBoundingClientRect();
    pop.style.left = `${2 * rect.left - landed.left}px`;
    pop.style.bottom = `${bottom + (landed.bottom - (rect.top - 6))}px`;
  };
  const panel = () => toggle.closest(".tg-panel");
  const onOutside = (event: Event) => {
    if (!event.composedPath().includes(box)) close(false);
  };
  const onMoved = () => close(false);
  function close(refocus: boolean): void {
    if (pop.hidden) return;
    pop.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onMoved);
    panel()?.removeEventListener("scroll", onMoved);
    if (refocus) toggle.focus();
  }
  function open(): void {
    pop.hidden = false;
    place();
    toggle.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onMoved);
    panel()?.addEventListener("scroll", onMoved);
    pop.querySelector<HTMLButtonElement>("button")?.focus();
  }
  toggle.addEventListener("click", () => (pop.hidden ? open() : close(true)));
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || pop.hidden) return;
    event.stopPropagation();
    close(true);
  });
  box.append(toggle, pop);
  return box;
}

/** Not set up for imports: the bubble opens Download adapted's own panel, with a way to set imports up under it. */
export function mountAdaptBubble(
  root: ShadowRoot,
  provider: ProviderId,
  pageUrl: string,
  site: AdaptSite,
  targets: AdaptTarget[],
  onSetUp: () => void,
): void {
  const toggle = mountPanel(root, () => {
    renderPanel(pageHeadHtml(provider, pageUrl, "Download adapted"));
    const foot = element("div", "tg-hint ad-foot", "Want it in your Thingport library as well? ");
    const setUp = element("button", "ad-link", "Set up Grab");
    setUp.type = "button";
    setUp.addEventListener("click", onSetUp);
    foot.append(setUp);
    const body = element("div", "");
    body.append(adaptedRows(site, pageUrl, targets), foot);
    setPanelExtra(body);
  });
  mountFab(root, { variant: "adapt", label: "Download adapted copies of this model", onClick: toggle });
}
