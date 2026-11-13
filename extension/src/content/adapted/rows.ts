// Download adapted in Grab's bubble: a row per copy (its printer or slicer, and what it's for), each downloading its
// copy on a click and saying on the row how it's going, with the file to adapt picked above them where the model has
// several 3MFs. Where the bubble can't import from the page, its panel is these rows; where it can, they open above a
// secondary "Download adapted" under the import, over the panel, as an extra beside it.

import { targetName } from "../../shared/adaptTargets";
import { send } from "../../shared/messages";
import type { ProviderId } from "../../providers/index.generated";
import { pageHeadHtml } from "../panels/modelHead";
import { renderPanel, setPanelExtra, mountFab, mountPanel } from "../shell";
import { downloadAdapted } from "./download";
import { explanation, savedNote } from "./offer";
import { ICONS, element, shownName, sizeText, svg, targetPicture } from "./popover";
import type { PageAdapt } from "./site";

const DONE_RESET_MS = 3000;

const downloadIcon = () => svg(ICONS.download);

let picks = 0;

/** A row per copy; `compact` for the rows under an import. */
export function adaptedRows(page: PageAdapt, pageUrl: string, compact = false): HTMLElement {
  const { site, files, targets } = page;
  const box = element("div", "ad");
  // The one the page has picked, where it picks one of them.
  const picked = site.selected?.(files);
  let file = picked && picked !== "other" ? picked : files[0];
  if (files.length > 1) {
    const id = `tg-ad-file-${++picks}`;
    const label = element("label", "tg-label ad-file__label", "3MF file");
    label.htmlFor = id;
    const select = element("select", "tg-select ad-file");
    select.id = id;
    for (const [at, option] of files.entries()) {
      const size = sizeText(option.size);
      select.append(new Option(size ? `${shownName(option)} (${size})` : shownName(option), String(at)));
    }
    select.value = String(files.indexOf(file));
    select.addEventListener("change", () => (file = files[Number(select.value)] ?? files[0]));
    box.append(label, select);
  }
  const list = element("div", `ad-list${compact ? " ad-list--compact" : ""}`);
  const error = element("div", "tg-hint ad-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  // What's worth knowing about the copy saved last, until the next one.
  const note = element("div", "tg-hint ad-note");
  note.setAttribute("role", "status");
  note.hidden = true;
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
      note.hidden = true;
      for (const other of box.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) {
        other.disabled = true;
      }
      go.replaceChildren(element("span", "ad-item__spinner"));
      void send("SET_ADAPT_LAST", { key: target.key });
      try {
        const saved = await downloadAdapted(site, pageUrl, file, target, (status) => (subEl.textContent = status));
        subEl.textContent = "Downloaded";
        const said = savedNote(target, saved);
        note.textContent = said ?? "";
        note.hidden = !said;
        await new Promise((resolve) => setTimeout(resolve, DONE_RESET_MS));
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        error.hidden = false;
      } finally {
        busy = false;
        subEl.textContent = sub;
        go.replaceChildren(downloadIcon());
        for (const other of box.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) {
          other.disabled = false;
        }
      }
    });
    list.append(row);
  }
  box.append(list, note, error);
  return box;
}

/** Set up for imports: under the import, a button as big as its own, in the quieter secondary style, whose copies open
 *  above it over the panel rather than growing it. Escape, a click elsewhere or the panel scrolling closes them. */
export function adaptedReveal(page: PageAdapt, pageUrl: string): HTMLElement {
  const box = element("div", "ad-more");
  const toggle = element("button", "tg-btn tg-btn--secondary ad-reveal");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.append(svg(ICONS.download), element("span", "", "Download adapted"));
  const pop = element("div", "ad-pop");
  pop.id = "tg-adapted-copies";
  pop.setAttribute("role", "group");
  pop.setAttribute("aria-label", "Copies to download");
  pop.hidden = true;
  pop.append(adaptedRows(page, pageUrl, true));
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
    pop.querySelector<HTMLElement>("select, button")?.focus();
  }
  toggle.addEventListener("click", () => (pop.hidden ? open() : close(true)));
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || pop.hidden) return;
    event.stopPropagation();
    close(true);
  });
  // Tabbing out of them closes them too. Focus going nowhere (a click on the list's own padding) leaves them open.
  box.addEventListener("focusout", (event) => {
    const to = event.relatedTarget as Node | null;
    if (to && !box.contains(to)) close(false);
  });
  box.append(toggle, pop);
  return box;
}

/** A line under the copies, with the one thing to do about it: setting imports up, say. */
export type AdaptFoot = { text: string; action: string; onClick: () => void };

/** Where the bubble can't import from the page: it opens Download adapted's own panel, with `foot` under it. */
export function mountAdaptBubble(
  root: ShadowRoot,
  provider: ProviderId,
  pageUrl: string,
  page: PageAdapt,
  foot: AdaptFoot | null,
): void {
  const toggle = mountPanel(root, () => {
    renderPanel(pageHeadHtml(provider, pageUrl, "Download adapted"));
    const body = element("div", "");
    body.append(adaptedRows(page, pageUrl));
    if (foot) {
      const line = element("div", "tg-hint ad-foot", foot.text);
      const action = element("button", "ad-link", foot.action);
      action.type = "button";
      action.addEventListener("click", foot.onClick);
      line.append(action);
      body.append(line);
    }
    setPanelExtra(body);
  });
  mountFab(root, { variant: "adapt", label: "Download adapted copies of this model", onClick: toggle });
}
