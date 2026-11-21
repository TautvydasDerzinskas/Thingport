// What the picture's part and the window share: the sticky-note drawing, icons, the menu, avatars and their styles.

/** The tool's icon and the picture's note button: one drawing, so the two match. */
export const NOTE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#f6d77b" d="M8 5h32a3 3 0 0 1 3 3v22L30 43H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z"/><path fill="#c69132" d="M30 43V33a3 3 0 0 1 3-3h10z"/><path fill="none" stroke="#5a471f" stroke-linecap="round" stroke-width="2.5" d="M13 16h22m-22 7h16"/></svg>';

// Material icons, as the rest of Thingport draws them.
const ICONS = {
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  open: "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  eyeOff:
    "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  globe:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  grip: "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  bubble: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  sticky:
    "M19 3H4.99C3.89 3 3 3.9 3 5l.01 14c0 1.1.89 2 1.99 2h10l6-6V5c0-1.1-.9-2-2-2zM7 8h10v2H7V8zm5 6H7v-2h5v2zm2 5.5V14h5.5L14 19.5z",
  lines: "M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z",
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

export function el(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (tag === "button") element.type = "button";
  return element;
}

/** Puts the tool's class, and the dark one in the dark theme, on an element it draws. */
export function themed(thingport, element) {
  element.classList.add("tpn");
  if (thingport.theme?.mode === "dark") element.classList.add("tpn-dark");
  return element;
}

export function avatar(person, fallback) {
  const element = el("span", "tpn-avatar");
  element.setAttribute("aria-hidden", "true");
  if (person?.avatarUrl) {
    const image = el("img");
    image.src = person.avatarUrl;
    image.alt = "";
    element.append(image);
  } else element.textContent = fallback;
  return element;
}

const MENU_WIDTH = 220;

/**
 * A button that opens a menu lined up under its right edge, as Thingport's ⋮ menus are: the popover opens under its
 * anchor's left edge, so the anchor is a hidden strip as wide as the menu, ending where the button does.
 */
export function menuButton(button) {
  const wrap = el("span", "tpn-menu-wrap");
  const anchor = el("span", "tpn-menu-anchor");
  anchor.style.width = MENU_WIDTH + "px";
  anchor.setAttribute("aria-hidden", "true");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  wrap.append(button, anchor);
  return { wrap, anchor };
}

/**
 * Opens a menu of `items`: `{ icon, label, action, danger, disabled, title }`, `{ divider: true }`, or a switch with
 * `checked`, whose action gets the new state and which leaves the menu open. An item's action gets a promise of the
 * menu being gone, for focusing what it opens.
 */
export function openMenu(thingport, button, anchor, items, onClose) {
  let handle = null;
  let shown = null;
  // The popover gives focus back to its button as it goes, so an action that focuses something waits for this.
  const gone = () =>
    new Promise((resolve) => {
      const started = performance.now();
      const check = () =>
        !shown?.isConnected || performance.now() - started > 1000 ? resolve() : requestAnimationFrame(check);
      requestAnimationFrame(check);
    });
  button.setAttribute("aria-expanded", "true");
  handle = thingport.ui.popover(
    anchor,
    (root) => {
      shown = root;
      const style = el("style");
      style.textContent = UI_CSS;
      const menu = themed(thingport, el("div", "tpn-menu"));
      menu.setAttribute("role", "menu");
      const entries = [];
      for (const item of items) {
        if (item.divider) {
          const line = el("hr");
          line.setAttribute("role", "separator");
          menu.append(line);
          continue;
        }
        const toggle = item.checked !== undefined;
        const entry = el("button", item.danger ? "tpn-danger" : "");
        entry.setAttribute("role", toggle ? "menuitemcheckbox" : "menuitem");
        if (toggle) entry.setAttribute("aria-checked", String(item.checked));
        // Still focusable when it can't be used, so its title says why.
        if (item.disabled) entry.setAttribute("aria-disabled", "true");
        if (item.title) entry.title = item.title;
        entry.append(icon(item.icon), el("span", "", item.label));
        if (toggle) entry.append(el("span", "tpn-switch"));
        entry.addEventListener("click", () => {
          if (item.disabled) return;
          if (toggle) {
            item.checked = !item.checked;
            entry.setAttribute("aria-checked", String(item.checked));
            item.action(item.checked);
            return;
          }
          handle?.close();
          item.action(gone());
        });
        entries.push(entry);
        menu.append(entry);
      }
      menu.addEventListener("keydown", (event) => {
        const at = entries.indexOf(document.activeElement);
        const next = {
          ArrowDown: (at + 1) % entries.length,
          ArrowUp: (at - 1 + entries.length) % entries.length,
          Home: 0,
          End: entries.length - 1,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        entries[next].focus();
      });
      root.append(style, menu);
      requestAnimationFrame(() =>
        (entries.find((entry) => !entry.hasAttribute("aria-disabled")) ?? entries[0])?.focus(),
      );
      return () => {
        button.setAttribute("aria-expanded", "false");
        onClose?.();
      };
    },
    { placement: "bottom", width: MENU_WIDTH },
  );
  return handle;
}

export const UI_CSS = `
.tpn {
  --tpn-yellow: #ffe58a; --tpn-pink: #ffc2d1; --tpn-blue: #b9dcff; --tpn-green: #c3efb8; --tpn-ink: #3d3412;
  --tpn-hover: color-mix(in srgb, var(--tp-text) 8%, transparent);
  --tpn-shadow: 0 10px 28px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.1);
  font: 13px/1.45 var(--tp-font);
  color: var(--tp-text);
}
.tpn.tpn-dark {
  --tpn-yellow: #e8cd68; --tpn-pink: #e3a2b3; --tpn-blue: #93bde6; --tpn-green: #a3d398; --tpn-ink: #2b250d;
  --tpn-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
}
.tpn :where(*, *::before, *::after), .tpn { box-sizing: border-box; }
.tpn :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
.tpn :where(button, textarea, input, [tabindex]):focus-visible { outline: 2px solid var(--tp-accent); outline-offset: 2px; }
.tpn :where(svg) { width: 18px; height: 18px; fill: currentColor; flex: none; }
.tpn [hidden] { display: none !important; }
.tpn-c-yellow { --tpn-paper: var(--tpn-yellow); }
.tpn-c-pink { --tpn-paper: var(--tpn-pink); }
.tpn-c-blue { --tpn-paper: var(--tpn-blue); }
.tpn-c-green { --tpn-paper: var(--tpn-green); }

.tpn-menu-wrap { position: relative; display: inline-flex; }
.tpn-menu-anchor { position: absolute; right: 0; bottom: -2px; height: 1px; visibility: hidden; pointer-events: none; }
.tpn-menu { display: flex; flex-direction: column; padding: 6px 0; font-size: 14px; }
.tpn-menu [role^="menuitem"] {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 36px; padding: 6px 16px; text-align: left;
  transition: background-color 150ms;
}
.tpn-menu [role^="menuitem"]:is(:hover, :focus-visible) { background: var(--tpn-hover); outline: none; }
.tpn-menu [role^="menuitem"] svg { width: 20px; height: 20px; color: var(--tp-text-muted); }
.tpn-menu [aria-disabled="true"] { opacity: 0.45; cursor: default; }
.tpn-menu [aria-disabled="true"]:hover { background: none; }
.tpn-menu .tpn-danger, .tpn-menu .tpn-danger svg { color: var(--tp-error); }
.tpn-menu hr { margin: 6px 0; border: 0; border-top: 1px solid var(--tp-divider); }
.tpn-switch {
  position: relative; flex: none; width: 34px; height: 14px; margin-left: auto; border-radius: 7px;
  background: color-mix(in srgb, var(--tp-text) 30%, transparent); transition: background-color 150ms;
}
.tpn-switch::after {
  content: ""; position: absolute; left: -3px; top: -3px; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); transition: transform 150ms, background-color 150ms;
}
.tpn-dark .tpn-switch::after { background: var(--tp-text); }
[aria-checked="true"] > .tpn-switch { background: color-mix(in srgb, var(--tp-accent) 50%, transparent); }
[aria-checked="true"] > .tpn-switch::after { transform: translateX(20px); background: var(--tp-accent); }

.tpn-icon-btn {
  flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
  color: var(--tp-text-muted); transition: background-color 150ms, color 150ms;
}
.tpn-icon-btn:hover { background: var(--tpn-hover); color: var(--tp-text); }
.tpn-avatar {
  flex: none; display: grid; place-items: center; width: 28px; height: 28px; overflow: hidden; border-radius: 50%;
  background: var(--tp-accent); color: var(--tp-accent-ink); font-size: 11.5px; font-weight: 700;
}
.tpn-avatar img { width: 100%; height: 100%; object-fit: cover; }

@keyframes tpn-in { from { opacity: 0; scale: 0.8; } }
@keyframes tpn-pop { from { opacity: 0; translate: 0 4px; } }
@keyframes tpn-fade { from { opacity: 0; } }
@keyframes tpn-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .tpn, .tpn *, .tpn *::before, .tpn *::after { animation: none !important; transition: none !important; }
}
@media (pointer: coarse) {
  .tpn-menu [role^="menuitem"] { min-height: 44px; }
  .tpn-icon-btn { width: 44px; height: 44px; }
}
`;
