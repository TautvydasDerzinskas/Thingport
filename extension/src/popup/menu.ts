// A small menu under a tile (a printer's nozzle and Remove): arrow keys move through it and Enter picks. Escape closes
// it and gives focus back to the tile; Tab or a click elsewhere closes it and leaves focus where it went.

import { el, icon, ICONS } from "./adaptTiles";

export type MenuEntry =
  { heading: string } | "separator" | { label: string; checked?: boolean; danger?: boolean; select: () => void };

let open: { menu: HTMLElement; anchor: HTMLElement; dismiss: (event: Event) => void } | null = null;

export function closeMenu({ refocus = true } = {}): void {
  if (!open) return;
  const { menu, anchor, dismiss } = open;
  open = null;
  menu.remove();
  document.removeEventListener("pointerdown", dismiss, true);
  if (refocus) anchor.focus();
}

export function openMenu(anchor: HTMLElement, label: string, entries: MenuEntry[]): void {
  closeMenu({ refocus: false });
  const menu = el("div", "menu");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  const items: HTMLButtonElement[] = [];
  for (const entry of entries) {
    if (entry === "separator") {
      const line = el("div", "menu__sep");
      line.setAttribute("role", "separator");
      menu.append(line);
    } else if ("heading" in entry) {
      menu.append(el("div", "menu__heading", entry.heading));
    } else {
      const item = el("button", `menu__item${entry.danger ? " menu__item--danger" : ""}`, entry.label);
      item.type = "button";
      item.tabIndex = -1;
      if (entry.checked !== undefined) {
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", String(entry.checked));
        item.append(el("span", "menu__tick", icon(ICONS.check)));
      } else {
        item.setAttribute("role", "menuitem");
      }
      item.addEventListener("click", () => {
        closeMenu();
        entry.select();
      });
      items.push(item);
      menu.append(item);
    }
  }
  menu.addEventListener("keydown", (event) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => items[(to + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") closeMenu();
    else if (event.key === "Tab") closeMenu({ refocus: false });
    else return;
    // Escape included: the view under the menu stays open.
    if (event.key !== "Tab") event.preventDefault();
  });
  document.body.append(menu);
  // Under the tile, kept inside the popup.
  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
  const below = box.bottom + 4 + menu.offsetHeight <= window.innerHeight;
  menu.style.top = `${below ? box.bottom + 4 : Math.max(8, box.top - 4 - menu.offsetHeight)}px`;
  const dismiss = (event: Event) => {
    if (!menu.contains(event.target as Node)) closeMenu({ refocus: false });
  };
  document.addEventListener("pointerdown", dismiss, true);
  open = { menu, anchor, dismiss };
  (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
}
