// What the window and the model page's parts share: their base styles, icons, swatches, avatars, and the words for a
// filament, a spool and how the household's spools cover a model.

import { isHex, nameOf } from "./colour.js";
import { listNames } from "./shelf.js";

/** Styles every root this tool draws into gets: the window, the tab, the badge and its popover. */
export const BASE_CSS = `
.fs-ui {
  --fs-same: var(--tp-success);
  --fs-close: var(--tp-warning);
  --fs-tint: color-mix(in srgb, var(--tp-text) 6%, transparent);
  --fs-line: color-mix(in srgb, var(--tp-text) 25%, transparent);
  --fs-raised: var(--tp-paper);
  --fs-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.1);
  font-family: var(--tp-font);
  font-size: 13px;
  line-height: 1.45;
  color: var(--tp-text);
}
.fs-ui.fs-dark {
  --fs-raised: rgba(255, 255, 255, 0.16);
  --fs-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
.fs-ui :where(*, *::before, *::after) { box-sizing: border-box; }
.fs-ui [hidden] { display: none !important; }
.fs-ui :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
.fs-ui :where(input, select, textarea) { font: inherit; color: var(--tp-text); }
.fs-ui :where(button, input, select, textarea, [tabindex]):focus-visible { outline: 2px solid var(--tp-accent); outline-offset: 2px; }
.fs-ui :where(svg) { width: 18px; height: 18px; fill: currentColor; flex-shrink: 0; }
.fs-ui :where(small) { font-size: 11.5px; color: var(--tp-text-muted); }
.fs-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.fs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px;
  border: 1px solid transparent; border-radius: 8px; font-weight: 600; font-size: 12.5px; white-space: nowrap;
  color: var(--tp-accent); transition: background-color 150ms, border-color 150ms;
}
.fs-btn svg { width: 16px; height: 16px; }
.fs-btn:hover { background: color-mix(in srgb, var(--tp-accent) 8%, transparent); }
.fs-btn.fs-primary { background: var(--tp-accent); color: var(--tp-accent-ink); }
.fs-btn.fs-primary:hover { background: color-mix(in srgb, var(--tp-accent) 85%, var(--tp-text)); }
.fs-btn.fs-outline { border-color: var(--tp-accent); }
.fs-btn.fs-quiet { color: var(--tp-text); }
.fs-btn.fs-quiet:hover { background: var(--fs-tint); }
.fs-btn.fs-small { height: 26px; padding: 0 10px; font-size: 12px; }
.fs-btn:disabled { opacity: 0.5; cursor: default; }
.fs-icon-btn {
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center;
  justify-content: center; color: var(--tp-text-muted); transition: background-color 150ms, color 150ms;
}
.fs-icon-btn:hover { background: var(--fs-tint); color: var(--tp-text); }

.fs-input, .fs-select {
  height: 32px; min-width: 0; padding: 0 10px; border: 1px solid var(--fs-line); border-radius: 8px;
  background: var(--tp-paper); transition: border-color 150ms, box-shadow 150ms;
}
.fs-select { padding-right: 6px; cursor: pointer; }
.fs-input.fs-small, .fs-select.fs-small { height: 28px; font-size: 12.5px; }
.fs-input:focus, .fs-select:focus { outline: none; border-color: var(--tp-accent); box-shadow: 0 0 0 1px var(--tp-accent); }
.fs-input[aria-invalid="true"] { border-color: var(--tp-error); box-shadow: 0 0 0 1px var(--tp-error); }
.fs-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }

.fs-seg {
  display: inline-flex; flex-wrap: wrap; max-width: 100%; gap: 2px; padding: 3px; border: 1px solid var(--tp-divider);
  border-radius: 10px; background: var(--fs-tint);
}
.fs-seg > button {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 24px; padding: 0 10px;
  border-radius: 7px; font-size: 12.5px; white-space: nowrap; color: var(--tp-text-muted);
  transition: background-color 150ms, color 150ms, box-shadow 150ms;
}
.fs-seg > button:hover { color: var(--tp-text); }
.fs-seg > button[aria-pressed="true"] { background: var(--fs-raised); color: var(--tp-text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }
.fs-seg > button b { font-size: 11px; font-weight: 600; color: var(--tp-text-muted); }
.fs-seg > button svg { width: 16px; height: 16px; }
.fs-seg.fs-full { display: flex; }
.fs-seg.fs-full > button { flex: 1; }

.fs-av {
  --fs-person: var(--tp-text-muted);
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; overflow: hidden; display: inline-flex;
  align-items: center; justify-content: center; font-size: 10px; font-weight: 700; line-height: 1; color: #fff;
  background: var(--fs-person);
}
.fs-av img { width: 100%; height: 100%; object-fit: cover; }

.fs-sw {
  --fs-c: transparent;
  position: relative; display: inline-block; flex-shrink: 0; width: 18px; height: 18px; border-radius: 50% !important;
  background: var(--fs-c); box-shadow: inset 0 0 0 1px var(--fs-line);
}
.fs-sw.fs-s { width: 14px; height: 14px; }
.fs-sw.fs-l { width: 30px; height: 30px; }
.fs-sw.fs-any { background: transparent; box-shadow: none; border: 2px dashed var(--tp-text-muted); }
.fs-spool {
  --fs-c: #888;
  display: inline-block; flex-shrink: 0; width: 46px; height: 46px; border-radius: 50% !important;
  background: radial-gradient(closest-side, var(--tp-paper) 0 29%, rgba(0, 0, 0, 0.3) 30% 38%, var(--fs-c) 39% 92%,
    rgba(0, 0, 0, 0.2) 93% 99%, transparent 100%);
  transition: background 150ms;
}
.fs-spool.fs-l { width: 64px; height: 64px; }

.fs-palette { display: flex; flex-wrap: wrap; gap: 6px; }
.fs-palette > button {
  width: 22px; height: 22px; border-radius: 50% !important; background: var(--fs-c);
  box-shadow: inset 0 0 0 1px var(--fs-line); transition: transform 150ms;
}
.fs-palette > button:hover { transform: scale(1.12); }
.fs-palette > button[aria-checked="true"] { outline: 2px solid var(--tp-accent); outline-offset: 2px; }
.fs-palette > button.fs-any { background: transparent; box-shadow: none; border: 2px dashed var(--tp-text-muted); }

.fs-pill { display: inline-block; padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 700; line-height: 18px; white-space: nowrap; }
.fs-pill.fs-all { color: var(--fs-same); background: color-mix(in srgb, var(--fs-same) 14%, transparent); }
.fs-pill.fs-some { color: var(--fs-close); background: color-mix(in srgb, var(--fs-close) 16%, transparent); }
.fs-pill.fs-none { color: var(--tp-text-muted); background: var(--fs-tint); }
.fs-edited {
  display: inline-flex; align-items: center; gap: 3px; padding: 0 6px; border-radius: 5px; font-size: 11px;
  font-weight: 600; line-height: 20px; white-space: nowrap; color: var(--fs-close);
  background: color-mix(in srgb, var(--fs-close) 14%, transparent);
}
.fs-edited svg { width: 12px; height: 12px; }
.fs-has { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; color: var(--fs-same); }
.fs-has svg { width: 15px; height: 15px; }
.fs-near { font-weight: 700; color: var(--fs-close); }
.fs-no { color: var(--tp-text-muted); }

.fs-skel { display: block; border-radius: 6px; background: color-mix(in srgb, var(--tp-text) 8%, transparent); animation: fs-pulse 1.2s ease-in-out infinite alternate; }
@keyframes fs-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes fs-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes fs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fs-pulse { to { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .fs-ui *, .fs-ui *::before, .fs-ui *::after, .fs-ui { animation: none !important; transition: none !important; }
}
`;

/** Puts a stylesheet first in a root, which Thingport empties when the part or window goes. */
export function addStyle(root, css) {
  const style = document.createElement("style");
  style.textContent = css;
  root.prepend(style);
  return style;
}

/** The class that gives the dark theme's raised surfaces. */
export const themeClass = (thingport) => (thingport.theme?.mode === "dark" ? "fs-dark" : "fs-light");

export const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const PATHS = {
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  check:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  warn: "M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  palette:
    "M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
  reset: "M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
  shelf:
    "M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z",
  profile:
    "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  chevron: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  drop: "M7 10l5 5 5-5z",
  share:
    "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  done: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  queue: "M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z",
  picker:
    "M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12a1 1 0 0 0 .01-1.42zM6.92 19 5 17.08l8.06-8.06 1.92 1.92L6.92 19z",
};

/** A 24 px icon by name, hidden from screen readers: whatever it's on carries the words. */
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATHS[name]}"/></svg>`;

/** A round swatch of a "#RRGGBB" (already checked), or a dashed one for any colour. */
// Only a colour ever goes into a style: what others share can say anything.
export const swatch = (hex, size = "") =>
  isHex(hex)
    ? `<span class="fs-sw ${size}" style="--fs-c:${hex}" aria-hidden="true"></span>`
    : `<span class="fs-sw fs-any ${size}" aria-hidden="true"></span>`;

/** A spool seen from the side, wound with the colour. */
export const spoolArt = (hex, size = "") =>
  `<span class="fs-spool ${size}" style="--fs-c:${isHex(hex) ? hex : "var(--tp-divider)"}" aria-hidden="true"></span>`;

/** A person's colour, from their id, so they look the same everywhere. */
export function personColour(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 45%)`;
}

/** What a person is called here: "You" for the reader. */
export const personName = (t, person) => (person.mine ? t("people.you") : (person.name ?? "?"));

/** A person's picture, or their initial on their colour. */
export function avatar(t, person, size = "") {
  const name = person.name ?? personName(t, person);
  const style = `--fs-person: ${personColour(person.id ?? name)}`;
  const inner = person.avatarUrl
    ? `<img src="${escapeHtml(person.avatarUrl)}" alt="">`
    : escapeHtml(name.trim().slice(0, 1).toUpperCase() || "?");
  return `<span class="fs-av ${size}" style="${style}" aria-hidden="true">${inner}</span>`;
}

/** Grams as a reader's language writes them: "12", "4.5". */
export function formatGrams(grams, language) {
  const digits = { maximumFractionDigits: grams < 10 ? 1 : 0 };
  try {
    return new Intl.NumberFormat(language, digits).format(grams);
  } catch {
    return new Intl.NumberFormat("en", digits).format(grams);
  }
}

const colourWord = (t, hex) => t(`colour.${nameOf(hex)}`);

/** A needed filament's name: "PLA White". */
export function filamentLabel(t, need) {
  const colour = need.color ? colourWord(t, need.color) : null;
  if (need.type && colour) return t("fil.name", { type: need.type, colour });
  return need.type ?? colour ?? t("fil.any");
}

/** What else there is to say about it: "40 g · plates 1, 2". */
export function filamentDetail(t, need, language) {
  const parts = [];
  if (need.grams !== null) parts.push(t("fil.grams", { grams: formatGrams(need.grams, language) }));
  if (need.plates.length) parts.push(t("fil.plates", { count: need.plates.length, plates: need.plates.join(", ") }));
  if (!need.color) parts.push(t("fil.anyColour"));
  else if (!need.type) parts.push(t("fil.anyMaterial"));
  return parts.join(" · ");
}

/** A spool's short name: its brand and colour, "Bambu Lab Jade White". */
export function spoolLabel(t, spool) {
  return [spool.brand, spool.colorName || colourWord(t, spool.color)].filter(Boolean).join(" ");
}

/** How a match grades, as a class: everyone together has all, some or none of what's needed. */
export const tone = (match) => (match.have === match.count ? "fs-all" : match.have ? "fs-some" : "fs-none");

/** A sentence on how the household's spools cover the filaments. */
export function summary(t, match, everyone) {
  const solo = everyone.length < 2;
  if (match.have === match.count) return t(solo ? "sum.allSolo" : "sum.all", { count: match.count });
  if (!match.have) return t("sum.none", { count: match.count });
  const names = listNames(
    match.missing.map((need) => filamentLabel(t, need)),
    t("and"),
  );
  return t(solo ? "sum.someSolo" : "sum.some", { have: match.have, count: match.count, names });
}

/** The same, in a few words, for the badge. */
export function shortSummary(t, match) {
  if (match.have === match.count) return t("short.all", { count: match.count });
  if (!match.have) return t("short.none", { count: match.count });
  return t("short.some", { have: match.have, count: match.count });
}

/** Runs `fn`, showing what went wrong in a toast rather than leaving it unhandled. */
export function toastFailures(thingport, fn, isClosed = () => false) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      if (!isClosed())
        thingport.ui.toast(thingport.t("toast.failed", { error: error?.message || String(error) }), "error");
    }
  };
}
