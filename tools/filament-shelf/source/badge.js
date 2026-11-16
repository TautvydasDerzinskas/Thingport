// The mark on a model's picture: a ring filled by how many of the filaments the household has, the first few
// colours inside it, and a popover naming who has each.

import { loadForModel } from "./shelf.js";
import {
  BASE_CSS,
  addStyle,
  avatar,
  escapeHtml,
  filamentDetail,
  filamentLabel,
  icon,
  personName,
  shortSummary,
  swatch,
  themeClass,
  tone,
} from "./parts.js";

const BADGE_CSS = `
.fs-badge {
  --fs-ring: rgba(255, 255, 255, 0.35);
  --fs-fill: 0%;
  width: 44px; height: 44px; border-radius: 50% !important; display: flex; align-items: center; justify-content: center;
  background: conic-gradient(var(--fs-ring) 0 var(--fs-fill), rgba(255, 255, 255, 0.3) var(--fs-fill) 100%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); animation: fs-pop 180ms ease-out; transition: transform 150ms;
}
.fs-badge:hover { transform: scale(1.06); }
.fs-badge:focus-visible { outline-color: #fff; }
.fs-badge.fs-all { --fs-ring: var(--tp-success); }
.fs-badge.fs-some { --fs-ring: var(--tp-warning); }
.fs-badge > span {
  width: 36px; height: 36px; border-radius: 50% !important; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.7);
}
.fs-stack { display: inline-flex; }
.fs-stack .fs-sw { width: 12px; height: 12px; box-shadow: none; border: 1.5px solid rgba(0, 0, 0, 0.7); }
.fs-stack .fs-sw.fs-any { border: 1.5px dashed rgba(255, 255, 255, 0.7); }
.fs-stack .fs-sw + .fs-sw { margin-left: -5px; }
`;

const POPOVER_CSS = `
.fs-pop { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
.fs-pop-head { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; font-weight: 600; }
.fs-pop-head svg { width: 16px; height: 16px; color: var(--tp-text-muted); }
.fs-pop-head .fs-icon-btn { margin-left: auto; width: 24px; height: 24px; }
.fs-pop-head .fs-icon-btn svg { width: 16px; height: 16px; }
.fs-pop-rows { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
.fs-pop-row { display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; align-items: center; font-size: 12.5px; animation: fs-in 160ms ease-out both; }
.fs-pop-row > span { min-width: 0; }
.fs-pop-row small { display: block; font-size: 11px; }
.fs-owners { display: flex; align-items: center; gap: 6px; }
.fs-owner { display: inline-flex; align-items: center; gap: 2px; }
.fs-owners .fs-av { width: 18px; height: 18px; font-size: 9px; }
.fs-nobody { font-size: 11px; font-weight: 600; color: var(--tp-error); }
.fs-pop-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--tp-divider); }
.fs-pop-sum { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
.fs-pop-sum svg { width: 16px; height: 16px; }
.fs-pop-sum.fs-all svg { color: var(--fs-same); }
.fs-pop-sum.fs-some svg { color: var(--fs-close); }
.fs-pop-sum.fs-none svg { color: var(--tp-text-muted); }
.fs-pop-foot .fs-btn { padding: 0 4px 0 8px; gap: 0; }
`;

export function modelImage(thingport) {
  const { root, shared, ui, t, context, language } = thingport;
  const style = document.createElement("style");
  style.textContent = BASE_CSS + BADGE_CSS;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const shell = document.createElement("div");
  shell.className = `fs-ui ${themeClass(thingport)}`;
  shell.append(button);

  let data = null;
  let popover = null;
  let redraw = null;
  let closed = false;
  let reads = 0;
  const titleId = `fs-pop-title-${Math.random().toString(36).slice(2, 8)}`;

  async function load() {
    const read = ++reads;
    try {
      const next = await loadForModel(thingport, context.modelId, context.fileId);
      if (closed || read !== reads) return;
      data = next;
    } catch {
      // A mark on a picture says nothing rather than an error; the tab says what went wrong.
      if (closed || read !== reads) return;
      data = null;
    }
    render();
  }

  function render() {
    if (!data?.needs.length) {
      popover?.close();
      root.replaceChildren();
      return;
    }
    const { match, needs } = data;
    const label = t("badge.label", { summary: shortSummary(t, match) });
    button.className = `fs-badge ${tone(match)}`;
    button.style.setProperty("--fs-fill", `${(match.have / match.count) * 100}%`);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = `<span><span class="fs-stack">${needs
      .slice(0, 3)
      .map((need) => swatch(need.color))
      .join("")}</span></span>`;
    if (!root.contains(button)) root.replaceChildren(style, shell);
    redraw?.();
  }

  function owners(cells) {
    const has = cells
      .map((found, j) => found && { found, person: data.everyone[j] })
      .filter(Boolean)
      .map(({ found, person }) => {
        const close = found.grade === "close";
        const key = `pop.${close ? "close" : "has"}${person.mine ? "You" : ""}`;
        const said = escapeHtml(t(key, { name: personName(t, person) }));
        return `<span class="fs-owner" title="${said}">${avatar(t, person)}${close ? '<span class="fs-near" aria-hidden="true">≈</span>' : ""}<span class="fs-sr">${said}</span></span>`;
      });
    return has.length ? has.join("") : `<span class="fs-nobody">${escapeHtml(t("pop.nobody"))}</span>`;
  }

  function drawPopover(box) {
    const { match } = data;
    const kind = tone(match);
    const html = `
      <h3 class="fs-pop-head" id="${titleId}">${icon("palette")}<span>${escapeHtml(t("pop.title"))}</span><button type="button" class="fs-icon-btn" data-act="close" aria-label="${escapeHtml(t("pop.closeLabel"))}" title="${escapeHtml(t("pop.closeLabel"))}">${icon("close")}</button></h3>
      <ul class="fs-pop-rows">${match.rows
        .map(
          ({ need, cells }, i) =>
            `<li class="fs-pop-row" style="animation-delay:${Math.min(i, 6) * 25}ms">${swatch(need.color)}<span>${escapeHtml(filamentLabel(t, need))}<small>${escapeHtml(filamentDetail(t, need, language))}</small></span><span class="fs-owners">${owners(cells)}</span></li>`,
        )
        .join("")}</ul>
      <div class="fs-pop-foot"><span class="fs-pop-sum ${kind}">${icon(kind === "fs-all" ? "check" : "warn")}<span>${escapeHtml(shortSummary(t, match))}</span></span><button type="button" class="fs-btn fs-small" data-act="details">${escapeHtml(t("pop.details"))}${icon("chevron")}</button></div>`;
    // Drawn again only when it says something new, and then with the focus where it was, so a change elsewhere
    // neither replays the rows coming in nor drops a keyboard user back to the page's start.
    if (html === box.dataset.html) return;
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    box.dataset.html = html;
    box.innerHTML = html;
    if (focused) box.querySelector(`[data-act="${focused}"]`)?.focus();
  }

  button.addEventListener("click", () => {
    if (popover) return popover.close();
    popover = ui.popover(
      button,
      (popRoot) => {
        addStyle(popRoot, BASE_CSS + POPOVER_CSS);
        const box = document.createElement("div");
        box.className = `fs-ui fs-pop ${themeClass(thingport)}`;
        box.setAttribute("role", "group");
        box.setAttribute("aria-labelledby", titleId);
        popRoot.append(box);
        box.addEventListener("click", (event) => {
          const act = event.target.closest("button")?.dataset.act;
          if (act === "close") popover?.close();
          if (act === "details") {
            popover?.close();
            ui.showTab();
          }
        });
        redraw = () => drawPopover(box);
        redraw();
        button.setAttribute("aria-expanded", "true");
        return () => {
          redraw = null;
          popover = null;
          button.setAttribute("aria-expanded", "false");
        };
      },
      { placement: "bottom", width: 330 },
    );
  });

  const stop = shared.onChange?.(() => void load()) ?? (() => {});
  void load();

  return () => {
    closed = true;
    stop();
    popover?.close();
  };
}
