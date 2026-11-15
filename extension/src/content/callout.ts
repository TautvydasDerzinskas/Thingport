// An offer by the floating icon (styles/_callout.scss): what's waiting, a button to see to it and one to put it off.
// Not modal: the page stays usable, and nothing here takes the focus from it.

import { escapeHtml } from "./runtime";

export type CalloutButton = { label: string; onClick: () => void };

export function mountCallout(
  root: ShadowRoot,
  { title, sub, primary, secondary }: { title: string; sub: string; primary: CalloutButton; secondary: CalloutButton },
): HTMLElement {
  const callout = document.createElement("div");
  callout.className = "tg-callout";
  callout.setAttribute("role", "region");
  callout.setAttribute("aria-labelledby", "tg-callout-title");
  callout.innerHTML = `
    <div class="tg-callout__text" role="status">
      <span class="tg-callout__title" id="tg-callout-title">${escapeHtml(title)}</span>
      <span class="tg-callout__sub">${escapeHtml(sub)}</span>
    </div>
    <button class="tg-btn" type="button" data-action="primary">${escapeHtml(primary.label)}</button>
    <button class="tg-btn tg-btn--secondary" type="button" data-action="secondary">${escapeHtml(secondary.label)}</button>
    <span class="tg-callout__tail" aria-hidden="true"></span>`;
  callout.querySelector("[data-action=primary]")!.addEventListener("click", primary.onClick);
  callout.querySelector("[data-action=secondary]")!.addEventListener("click", secondary.onClick);
  root.appendChild(callout);
  return callout;
}
