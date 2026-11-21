import {
  COLORS,
  LIMIT,
  NoteChanged,
  NoteGone,
  ago,
  confirmRemove,
  initials,
  newNoteKey,
  noteId,
  noteValue,
  onNotesChange,
  readNotes,
  readView,
  rebaseEdit,
  saveNote,
  storedNote,
  writeView,
} from "./notes.js";
import { NOTE_SVG, UI_CSS, avatar, el, icon, menuButton, openMenu, themed } from "./ui.js";

// The model page's part: the sticky-note button in the picture's corner and its menu, the notes over the picture as
// bubbles or sticky notes, a note opened in place, and the editor, which is the note itself and can be dragged.

const EDGE = 4;
// Unsaved edits by viewer, model and picture, several to a picture, each by the edit it came from: switching pictures
// draws the part afresh, and coming back brings the edit back. Another account signed in on the page sees none.
const drafts = new Map();
// Told a picture's key when its draft is free to come back, as after a save that failed once the picture had changed.
const draftsFreed = new EventTarget();

// Each save's look and colour picks, numbered as saves start: one finishing after a newer save that set the same field
// doesn't put back the older choice.
let picks = 0;

// The viewer's settings, one copy for every picture on the page, so switching pictures neither reads them again nor
// races another picture's writes: read once, then written one change at a time, each write the settings as they are
// when it starts, so the last change is the one kept. A change made before the read arrives wins over it. A failed
// read is tried again, by the next picture and before any write, so the defaults never go over saved settings.
const settingsByUser = new Map();

function readSettings(settings, { storage, api }) {
  settings.reading ??= Promise.all([readView(storage), stillSignedIn(api, settings.userId)])
    .then(([stored, owner]) => {
      // Read under someone else's session, as after signing in as another account: not theirs to keep.
      if (!owner) throw new Error("Signed in as someone else");
      settings.view = { ...stored, ...settings.early };
      settings.read = true;
      for (const listener of settings.listeners) listener();
    })
    .finally(() => (settings.reading = null));
  return settings.reading;
}

function settingsFor(thingport) {
  const { user, tool } = thingport;
  const userId = user?.id ?? "";
  // By tool too: two tools with the same code share this module, but not their settings.
  const owner = (tool?.id ?? "") + "|" + userId;
  let settings = settingsByUser.get(owner);
  if (!settings) {
    settings = {
      userId,
      view: { hidden: false, look: "sticky", color: "yellow" },
      read: false,
      early: {},
      listeners: new Set(),
    };
    settingsByUser.set(owner, settings);
    settings.writing = Promise.resolve();
  }
  if (!settings.read) loadSettings(settings, thingport);
  return settings;
}

/** The settings as saved, read now if they haven't been: resolves either way, as the defaults stand in meanwhile. */
function loadSettings(settings, thingport) {
  return settings.read ? Promise.resolve() : readSettings(settings, thingport).catch(() => undefined);
}

/** Whether the page is still signed in as `userId`: a write waiting in line mustn't land in another account's. */
async function stillSignedIn(api, userId) {
  const res = await api("/me").catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  return Boolean(userId) && body?.user?.id === userId;
}

function changeSettings(settings, thingport, change) {
  const { storage, api } = thingport;
  settings.view = { ...settings.view, ...change };
  if (!settings.read) Object.assign(settings.early, change);
  for (const listener of settings.listeners) listener();
  const write = settings.writing.then(async () => {
    // Checked before reading too, so a read under another account's session is never taken for the owner's.
    if (!(await stillSignedIn(api, settings.userId))) throw new Error("Signed in as someone else");
    if (!settings.read) await readSettings(settings, thingport);
    await writeView(storage, settings.view);
  });
  // A failed write doesn't hold up the next.
  settings.writing = write.catch(() => undefined);
  return write;
}

const TILTS = [-3, -1.5, 1, 2.5, -2, 1.8];
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function tilt(key) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TILTS[Math.abs(hash) % TILTS.length];
}

const stickyWidth = (width) => clamp(Math.round(width * 0.24), 88, 136);
const editorWidth = (width, look) =>
  look === "sticky" ? clamp(Math.round(width * 0.3), 140, 190) : Math.min(240, width - 2 * EDGE);

// The bubble is a square turned 45° with one sharp corner: its tip sits half a diagonal below its centre.
const bubbleTip = (size) => (size / 2) * Math.SQRT2;
// The fewest pixels of text the editor shrinks to on a short picture.
const MIN_TEXT = 36;

/** A sticky hangs from its tape at the spot; a bubble's tip is on it. Both stay whole inside the picture. */
function spotRange(look, width, height, box) {
  if (look === "sticky") {
    return {
      x: [box.width / 2 + EDGE, width - box.width / 2 - EDGE],
      y: [EDGE + 6, height - box.height - EDGE + 6],
    };
  }
  const tip = bubbleTip(box.width);
  return { x: [box.width / 2 + 2, width - box.width / 2 - 2], y: [tip + box.width / 2 + 2, height - 2] };
}

/** Where a box anchored to `rect` goes: above it when there's room, else below, else wherever has more. */
function beside(rect, box, width, height, gap) {
  const left = clamp(rect.left + rect.width / 2 - box.width / 2, EDGE, width - box.width - EDGE);
  const above = rect.top - gap - box.height;
  const below = rect.top + rect.height + gap;
  if (above >= EDGE) return { left, top: above, side: "above" };
  if (below + box.height <= height - EDGE) return { left, top: below, side: "below" };
  const top = clamp(rect.top > height - rect.top - rect.height ? EDGE : height - box.height - EDGE, EDGE, height);
  return { left, top, side: "over" };
}

const PREVIEW_CSS = `
.tpn-corner { display: block; }
.tpn-button { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; transition: transform 150ms ease; }
.tpn-button > svg { width: 36px; height: 36px; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4)); transition: opacity 150ms; }
.tpn-button:is(:hover, [aria-expanded="true"]) { transform: rotate(-5deg) scale(1.06); }
.tpn-button[data-hidden="true"] > svg { opacity: 0.6; }
.tpn-badge {
  position: absolute; top: -4px; right: -5px; display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--tp-accent);
  color: var(--tp-accent-ink); font-size: 11px; font-weight: 700; box-shadow: 0 0 0 2px var(--tp-paper);
  animation: tpn-in 180ms ease-out backwards;
}
.tpn-button[data-hidden="true"] .tpn-badge { background: var(--tp-text-muted); color: var(--tp-paper); padding: 0 3px; }
.tpn-badge svg { width: 12px; height: 12px; }

.tpn-layer { position: absolute; inset: 0; pointer-events: none; }
.tpn-pins { position: absolute; inset: 0; transition: opacity 150ms; }
.tpn-layer.tpn-editing .tpn-pins { opacity: 0.45; }
.tpn-layer.tpn-editing .tpn-pins > * { pointer-events: none; }
.tpn-note { position: absolute; z-index: var(--tpn-z, 0); pointer-events: auto; animation: tpn-in 180ms ease-out backwards; }
.tpn-note:is(:hover, :focus-visible, [aria-expanded="true"]) { z-index: 999; }

.tpn-bubble {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50% 50% 50% 4px; rotate: -45deg;
  background: var(--tp-paper); color: var(--tp-text-muted); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: scale 150ms ease;
}
.tpn-bubble:is(:hover, [aria-expanded="true"]) { scale: 1.12; }
.tpn-bubble > * { rotate: 45deg; }
.tpn-bubble svg { width: 15px; height: 15px; }
.tpn-bubble.tpn-public { background: var(--tp-accent); color: var(--tp-accent-ink); }
.tpn-initials { font-size: 11px; font-weight: 700; }

.tpn-sticky {
  width: var(--tpn-w, 120px); padding: 0; text-align: left; rotate: var(--tpn-tilt, 0deg);
  filter: drop-shadow(0 5px 8px rgba(0, 0, 0, 0.28)) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18));
  transition: translate 150ms ease, rotate 150ms ease;
}
.tpn-sticky:is(:hover, [aria-expanded="true"]) { translate: 0 -2px; rotate: 0deg; }
.tpn-sheet {
  position: relative; display: block; padding: 14px 10px 10px; background: var(--tpn-paper); color: var(--tpn-ink);
  font-size: 12px; line-height: 1.35;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
}
.tpn-sheet::after {
  content: ""; position: absolute; right: 0; bottom: 0; width: 14px; height: 14px;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.2) 50%, transparent 50%);
}
.tpn-tape {
  position: absolute; left: 50%; top: -3px; z-index: 1; width: 42px; height: 12px; translate: -50% 0; rotate: 2deg;
  background: rgba(255, 255, 255, 0.55); box-shadow: 0 1px 1px rgba(0, 0, 0, 0.08);
}
.tpn-sticky-text {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.tpn-sticky-foot { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 10.5px; opacity: 0.75; }
.tpn-sticky-foot svg { width: 12px; height: 12px; }
.tpn-sticky-foot span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tpn-callout, .tpn-surface, .tpn-toolbar { position: absolute; pointer-events: auto; animation: tpn-pop 160ms ease-out backwards; }
.tpn-callout {
  z-index: 1000; display: grid; gap: 8px; width: var(--tpn-cw); padding: 10px 10px 12px 12px; border-radius: 10px;
  background: var(--tp-paper); color: var(--tp-text); box-shadow: var(--tpn-shadow);
}
.tpn-callout:focus { outline: none; }
.tpn-tail { position: absolute; left: var(--tpn-tail, 50%); width: 12px; height: 12px; margin-left: -6px; rotate: 45deg; background: inherit; }
[data-side="above"] > .tpn-tail { bottom: -6px; }
[data-side="below"] > .tpn-tail { top: -6px; }
[data-side="over"] > .tpn-tail { display: none; }
.tpn-who { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tpn-who-text { display: grid; min-width: 0; margin-right: auto; }
.tpn-who-text b { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.tpn-who-text small { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--tp-text-muted); }
.tpn-who-text small svg { width: 13px; height: 13px; }
.tpn-body { max-height: 180px; margin: 0; overflow: auto; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }

.tpn-editor { position: absolute; inset: 0; z-index: 1000; pointer-events: none; }
.tpn-edit-pin { position: absolute; pointer-events: auto; cursor: grab; touch-action: none; }
.tpn-surface { display: flex; flex-direction: column; outline: 2px solid var(--tp-accent); outline-offset: 2px; }
.tpn-surface.tpn-is-sticky { border-radius: 4px; background: var(--tpn-paper); color: var(--tpn-ink); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); }
.tpn-surface.tpn-is-bubble { border-radius: 10px; background: var(--tp-paper); color: var(--tp-text); box-shadow: var(--tpn-shadow); }
.tpn-grip { display: flex; align-items: center; justify-content: center; width: 100%; height: 18px; opacity: 0.55; cursor: grab; touch-action: none; }
.tpn-grip:is(:hover, :focus-visible) { opacity: 1; }
.tpn-grip:focus-visible { outline-offset: -3px; }
.tpn-grip svg { width: 18px; height: 18px; rotate: 90deg; }
.tpn-surface textarea {
  display: block; width: 100%; min-height: 58px; max-height: 140px; padding: 0 10px 10px; border: 0; outline: none;
  background: transparent; color: inherit; font: 12.5px/1.4 var(--tp-font); resize: none;
}
.tpn-surface textarea:focus-visible { outline: none; }
.tpn-surface textarea::placeholder { color: currentColor; opacity: 0.55; }
.tpn-surface textarea:disabled { opacity: 0.7; }
.tpn-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 2px; max-width: calc(100% - ${2 * EDGE}px); padding: 4px;
  border-radius: 10px; background: var(--tp-paper); color: var(--tp-text); box-shadow: var(--tpn-shadow);
}
.tpn-tool {
  display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--tp-text-muted);
  transition: background-color 150ms, color 150ms;
}
.tpn-tool:hover:not(:disabled) { background: var(--tpn-hover); color: var(--tp-text); }
.tpn-tool[aria-pressed="true"] { background: color-mix(in srgb, var(--tp-accent) 16%, transparent); color: var(--tp-accent); }
.tpn-tool:disabled { cursor: default; opacity: 0.4; }
.tpn-tool[aria-pressed="true"]:disabled { opacity: 1; }
.tpn-tool svg { width: 18px; height: 18px; }
.tpn-sep { width: 1px; height: 20px; margin: 0 3px; background: var(--tp-divider); }
.tpn-compact :is(.tpn-pair, .tpn-swatch):not([aria-pressed="true"]) { display: none; }
.tpn-compact .tpn-sep { margin: 0 1px; }
.tpn-toolbar.tpn-measure { flex-wrap: nowrap; max-width: none; }
.tpn-swatches { display: inline-flex; gap: 0; }
.tpn-swatch { display: inline-grid; place-items: center; width: 24px; height: 30px; }
.tpn-swatch::before {
  content: ""; width: 16px; height: 16px; border-radius: 50%; background: var(--tpn-paper);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18); transition: box-shadow 150ms;
}
.tpn-swatch[aria-pressed="true"]::before { box-shadow: 0 0 0 2px var(--tp-paper), 0 0 0 4px var(--tp-accent); }
.tpn-save {
  display: inline-flex; align-items: center; gap: 4px; height: 30px; margin-left: 2px; padding: 0 10px 0 7px;
  border-radius: 7px; background: var(--tp-accent); color: var(--tp-accent-ink); font-size: 12.5px; font-weight: 600;
  transition: filter 150ms, opacity 150ms;
}
.tpn-save:hover:not(:disabled) { filter: brightness(1.08); }
.tpn-save:disabled { cursor: default; opacity: 0.5; }
.tpn-save svg { width: 16px; height: 16px; }
.tpn-hint {
  position: absolute; left: 50%; top: 10px; display: flex; align-items: center; gap: 6px; max-width: calc(100% - 120px);
  padding: 4px 12px 4px 9px; overflow: hidden; translate: -50% 0; border-radius: 16px; background: rgba(0, 0, 0, 0.72);
  color: #fff; font-size: 12px; white-space: nowrap; text-overflow: ellipsis; pointer-events: none;
  animation: tpn-fade 200ms ease-out backwards; transition: opacity 200ms;
}
.tpn-hint svg { width: 15px; height: 15px; }
.tpn-hint.tpn-gone { opacity: 0; }
.tpn-dragging, .tpn-dragging * { cursor: grabbing !important; user-select: none; }
.tpn-dragging .tpn-surface, .tpn-dragging .tpn-toolbar { animation: none; }
@media (pointer: coarse) {
  .tpn-bubble { width: 36px; height: 36px; }
  .tpn-tool { width: 40px; height: 40px; }
  .tpn-swatch { width: 32px; height: 40px; }
  .tpn-save { height: 40px; }
  .tpn-grip { height: 28px; }
  .tpn-surface textarea { font-size: 16px; }
}
`;

// Each draw gets the visible bounds and identity of the current static picture: one per picture, made afresh when it
// changes. With no picture, as while the live 3D view shows, the button still opens the window.
export function modelImage(thingport) {
  const {
    root,
    preview,
    context: { modelId },
    t,
    ui,
    user,
    language,
  } = thingport;
  if (!modelId) return;
  const style = el("style");
  style.textContent = UI_CSS + PREVIEW_CSS;
  const corner = themed(thingport, el("div", "tpn-corner"));
  const button = el("button", "tpn-button");
  button.innerHTML = NOTE_SVG;
  button.firstElementChild.setAttribute("aria-hidden", "true");
  button.title = t("menu.title");
  const badge = el("span", "tpn-badge");
  badge.hidden = true;
  button.append(badge);
  const { wrap, anchor } = menuButton(button);
  corner.append(wrap);
  root.append(style, corner);

  const layer = preview ? themed(thingport, el("div", "tpn-layer")) : null;
  const pins = el("div", "tpn-pins");
  if (layer) {
    layer.append(pins);
    preview.root.append(layer);
  }

  let alive = true;
  let revision = 0;
  let notes = [];
  // The note opened in place, and the one being edited: never both.
  let reading = null;
  let editing = null;
  let confirming = false;
  // The pointer dragging the note being edited, if one is.
  let dragging = null;
  const visibility = (isPublic) => t(isPublic ? "visibility.public" : "visibility.personal");
  const writer = (note) => (note.mine ? t("note.you") : note.user?.name || t("note.someone"));
  const size = () => ({ width: layer?.clientWidth ?? 0, height: layer?.clientHeight ?? 0 });
  const draftKey = [thingport.tool?.id ?? "", user?.id ?? "", modelId, preview?.key ?? ""].join("|");
  // A new note of the viewer's on this picture, as it's kept once saved.
  const ownNote = (e) => ({ key: e.key, mine: true, modelId, ...(e.isPublic ? { public: true, user } : {}) });

  const settings = settingsFor(thingport);
  // The menu while it's open, so its switch follows a change made elsewhere or the settings arriving.
  let menu = null;
  const onSettings = () => {
    if (!alive) return;
    render();
    menu?.refresh();
  };
  settings.listeners.add(onSettings);
  const onDraftFreed = (event) => alive && event.detail === draftKey && load();
  draftsFreed.addEventListener("freed", onDraftFreed);

  function setView(change) {
    changeSettings(settings, thingport, change).catch(() => {
      // The switch keeps what was chosen here; the next page would show the saved choice, so say so.
      if ("hidden" in change) ui.toast(t("menu.showFailed"), "error");
    });
  }

  function renderButton() {
    const count = notes.length;
    button.dataset.hidden = String(settings.view.hidden);
    badge.hidden = !settings.view.hidden && !count;
    badge.replaceChildren(
      settings.view.hidden ? icon("eyeOff") : document.createTextNode(count > 99 ? "99+" : String(count)),
    );
    button.setAttribute("aria-label", settings.view.hidden ? t("menu.labelHidden") : t("menu.label", { count }));
  }

  button.addEventListener("click", () => {
    menu = openMenu(
      thingport,
      button,
      anchor,
      [
        {
          icon: "add",
          label: t("menu.add"),
          // A new note starts with the saved look and colour, on this picture if it's still the one shown.
          action: (gone) => loadSettings(settings, thingport).then(() => alive && startEdit(null, gone)),
          disabled: !layer || Boolean(editing),
          title: layer ? undefined : t("menu.noPicture"),
        },
        { icon: "open", label: t("menu.open"), action: () => ui.openWindow() },
        { divider: true },
        {
          icon: "eye",
          label: t("menu.show"),
          checked: () => !settings.view.hidden,
          action: (shown) => setView({ hidden: !shown }),
        },
      ],
      () => (menu = null),
    );
  });

  function noteElement(note) {
    const element = el("button", "tpn-note " + (note.value.look === "sticky" ? "tpn-sticky" : "tpn-bubble"));
    element.dataset.look = note.value.look;
    element.setAttribute("aria-haspopup", "dialog");
    element.setAttribute("aria-expanded", "false");
    element.addEventListener("click", () => toggleRead(element));
    element.addEventListener("dblclick", () => element.note.mine && startEdit(element.note));
    return element;
  }

  function fillNote(element, note) {
    const { value } = note;
    element.note = note;
    element.setAttribute("aria-label", t("note.open", { name: writer(note), text: value.text }));
    if (value.look === "sticky") {
      element.className = "tpn-note tpn-sticky tpn-c-" + value.color;
      element.style.setProperty("--tpn-tilt", tilt(note.key) + "deg");
      const sheet = el("span", "tpn-sheet");
      const foot = el("span", "tpn-sticky-foot");
      foot.append(icon(note.public ? "globe" : "lock"), el("span", "", note.public ? writer(note) : visibility(false)));
      sheet.append(el("span", "tpn-sticky-text", value.text), foot);
      element.replaceChildren(el("span", "tpn-tape"), sheet);
    } else {
      element.classList.toggle("tpn-public", Boolean(note.public));
      const name = note.public && (note.user?.name || (note.mine ? user?.name : null));
      element.replaceChildren(name ? el("span", "tpn-initials", initials(name)) : icon("lines"));
      element.title = value.text.length > 120 ? value.text.slice(0, 120) + "…" : value.text;
    }
  }

  function renderPins() {
    if (!layer) return;
    pins.hidden = settings.view.hidden;
    const old = new Map([...pins.children].map((element) => [element.dataset.id, element]));
    const keep = new Set();
    // Newest on top. A note already drawn stays where it is in the page, so it doesn't play its entrance again.
    notes.forEach((note, index) => {
      const id = noteId(note);
      let element = old.get(id);
      if (element && element.dataset.look !== note.value.look) {
        element.remove();
        element = null;
      }
      if (!element) {
        element = noteElement(note);
        element.dataset.id = id;
        pins.append(element);
      }
      fillNote(element, note);
      element.style.setProperty("--tpn-z", String(notes.length - index));
      // By key, so a new note whose failed save went through anyway isn't drawn behind its own editor.
      element.hidden = Boolean(editing && note.mine && note.key === editing.key);
      keep.add(element);
    });
    for (const element of old.values()) if (!keep.has(element)) element.remove();
    layoutPins();
  }

  function layoutPins() {
    const { width, height } = size();
    if (!width) return;
    for (const element of pins.children) {
      if (element.hidden) continue;
      const { x, y, look } = element.note.value;
      let box;
      if (look === "sticky") {
        element.style.setProperty("--tpn-w", stickyWidth(width) + "px");
        box = { width: element.offsetWidth, height: element.offsetHeight };
      } else box = { width: element.offsetWidth, height: element.offsetWidth };
      const range = spotRange(look, width, height, box);
      const left = clamp(x * width, ...range.x);
      const top = clamp(y * height, ...range.y);
      element.style.left = left - box.width / 2 + "px";
      element.style.top = (look === "sticky" ? top - 6 : top - bubbleTip(box.width) - box.width / 2) + "px";
    }
  }

  function rectOf(element) {
    return {
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  }

  // ---- A note opened in place ----

  function toggleRead(element) {
    if (editing) return;
    if (reading?.element === element) return closeRead(true);
    closeRead(false);
    const { note } = element;
    const callout = themed(thingport, el("div", "tpn-callout"));
    callout.tabIndex = -1;
    callout.setAttribute("role", "dialog");
    callout.setAttribute("aria-label", t("note.by", { name: writer(note) }));
    const who = el("div", "tpn-who");
    const text = el("div", "tpn-who-text");
    const meta = el("small");
    text.append(el("b", "", writer(note)), meta);
    who.append(avatar(note.mine ? user : note.user, initials(note.mine ? user?.name : writer(note)) || "?"), text);
    const body = el("p", "tpn-body");
    callout.append(who, body, el("span", "tpn-tail"));
    reading = { element, callout, meta, body, menuOpen: false };
    fillRead(note);
    if (note.mine) {
      const more = el("button", "tpn-icon-btn");
      more.append(icon("more"));
      more.setAttribute("aria-label", t("note.actions"));
      more.title = t("note.actions");
      const { wrap: moreWrap, anchor: moreAnchor } = menuButton(more);
      more.addEventListener("click", () => {
        const shown = reading;
        shown.menuOpen = true;
        openMenu(
          thingport,
          more,
          moreAnchor,
          [
            { icon: "edit", label: t("note.edit"), action: (gone) => startEdit(element.note, gone) },
            { divider: true },
            { icon: "delete", label: t("note.delete"), danger: true, action: () => remove(element.note) },
          ],
          () => (shown.menuOpen = false),
        );
      });
      who.append(moreWrap);
    }
    callout.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRead(true);
    });
    element.setAttribute("aria-expanded", "true");
    layer.append(callout);
    layoutRead();
    callout.focus({ preventScroll: true });
  }

  function fillRead(note) {
    reading.note = note;
    reading.meta.replaceChildren(
      icon(note.public ? "globe" : "lock"),
      el("span", "", visibility(Boolean(note.public))),
    );
    const when = note.updatedAt && ago(note.updatedAt, language, t("time.now"));
    if (when) reading.meta.append(el("span", "", "· " + when));
    reading.body.textContent = note.value.text;
  }

  function layoutRead() {
    if (!reading) return;
    const { width, height } = size();
    const { callout, element } = reading;
    callout.style.setProperty("--tpn-cw", Math.min(260, width - 2 * EDGE) + "px");
    const rect = rectOf(element);
    // A turned bubble reaches a little above its box.
    if (element.note.value.look === "bubble") rect.top -= 6;
    const box = { width: callout.offsetWidth, height: callout.offsetHeight };
    const place = beside(rect, box, width, height, 10);
    callout.style.left = place.left + "px";
    callout.style.top = place.top + "px";
    callout.dataset.side = place.side;
    callout.style.setProperty("--tpn-tail", clamp(rect.left + rect.width / 2 - place.left, 14, box.width - 14) + "px");
  }

  function closeRead(refocus) {
    if (!reading) return;
    const { element, callout } = reading;
    reading = null;
    callout.remove();
    element.setAttribute("aria-expanded", "false");
    if (refocus && element.isConnected) element.focus({ preventScroll: true });
  }

  function onPointerDown(event) {
    if (!reading || reading.menuOpen || confirming) return;
    if (reading.callout.contains(event.target) || reading.element.contains(event.target)) return;
    closeRead(false);
  }

  async function remove(note) {
    confirming = true;
    try {
      const removed = await confirmRemove(thingport, note);
      if (!removed || !alive) return;
      closeRead(false);
      notes = notes.filter((other) => noteId(other) !== noteId(note));
      render();
    } catch {
      if (alive) ui.toast(t("board.deleteFailed"), "error");
    } finally {
      confirming = false;
    }
  }

  // ---- The editor: the note itself, with a toolbar under it ----

  const EDITABLE = ["text", "look", "color", "x", "y"];
  const changedFields = (e) => EDITABLE.filter((field) => e[field] !== e.original[field]);

  // An edit kept for the picture: what it started from and only the fields it changed, now or in a save whose answer
  // was lost, so coming back applies those to the note as it is then, rather than writing back fields someone else has
  // changed since. One put back after such a save still comes back as the edit has it.
  function keepDraft(e, saving) {
    const fields = EDITABLE.filter((field) => [e, ...e.tried].some((sent) => sent[field] !== e.original[field]));
    const changes = Object.fromEntries(fields.map((field) => [field, e[field]]));
    if (!drafts.has(draftKey)) drafts.set(draftKey, new Map());
    drafts.get(draftKey).set(e.token, {
      note: e.note,
      key: e.key,
      isPublic: e.isPublic,
      tried: e.tried,
      chosen: e.chosen,
      moveKey: e.moveKey,
      base: e.original,
      changes,
      token: e.token,
      saving,
    });
  }

  function dropDraft(e) {
    const kept = drafts.get(draftKey);
    kept?.delete(e.token);
    if (kept && !kept.size) drafts.delete(draftKey);
  }

  // One at a time, and none whose save is still out: it comes back only if that save fails.
  const readyDraft = (skip) =>
    [...(drafts.get(draftKey)?.values() ?? [])].find((kept) => !kept.saving && !skip?.has(kept));
  const stillKept = (draft) => drafts.get(draftKey)?.get(draft.token) === draft && !draft.saving;

  async function restoreDraft() {
    // Past any whose note has been deleted since, or can't be checked now, to the first that can open: each once.
    const seen = new Set();
    let failed = false;
    for (;;) {
      const draft = !editing && readyDraft(seen);
      if (!draft) return;
      seen.add(draft);
      let note = draft.note && notes.find((candidate) => noteId(candidate) === noteId(draft.note));
      if (draft.note && !note) {
        // Not among this picture's notes isn't deleted: one from another copy shows only while the pictures can be
        // compared. Where it's kept says which; one still there comes back as it's stored.
        let stored;
        try {
          stored = await storedNote(thingport, draft.note);
        } catch {
          // Can't tell: this draft waits for the next load, said once however many fail.
          if (!alive) return;
          if (!failed) ui.toast(t("board.error"), "error");
          failed = true;
          continue;
        }
        if (!alive || editing || !stillKept(draft)) return;
        if (!stored) {
          dropDraft(draft);
          ui.toast(t("editor.deleted"), "warning");
          continue;
        }
        note = { ...draft.note, value: stored };
      }
      dropDraft(draft);
      const latest = note?.value ?? draft.base;
      startEdit(note ?? null, null, {
        ...latest,
        ...draft.changes,
        key: draft.key,
        isPublic: draft.isPublic,
        tried: draft.tried,
        chosen: draft.chosen,
        moveKey: draft.moveKey,
        // What a new note started as, which its changes are measured against.
        base: note ? undefined : draft.base,
      });
      // Changed here and somewhere else since: saving would replace the other change, so say so. A value this edit's
      // own save left there isn't such a change.
      const elsewhere = (field) =>
        latest[field] !== draft.base[field] && !draft.tried.some((sent) => sent[field] === latest[field]);
      if (note && Object.keys(draft.changes).some(elsewhere)) ui.toast(t("editor.conflict"), "warning");
      return;
    }
  }

  function startEdit(note, menuGone, draft) {
    if (!layer || editing) return;
    closeRead(false);
    // Adding or editing shows the notes again; a draft coming back doesn't, as its editor shows apart from them.
    if (settings.view.hidden && !draft) setView({ hidden: false });
    const original = note?.value ??
      draft?.base ?? {
        x: 0.5,
        y: settings.view.look === "sticky" ? 0.3 : 0.55,
        text: "",
        look: settings.view.look,
        color: settings.view.color,
      };
    const value = draft ?? original;
    const parts = buildEditor();
    editing = {
      ...parts,
      note,
      key: draft?.key ?? note?.key ?? newNoteKey(modelId, preview.key),
      isPublic: draft ? draft.isPublic : Boolean(note?.public),
      // What this edit's saves sent that may be stored even though the answer said otherwise: retries go where they
      // went, and a stored value one of them sent isn't taken for a change made somewhere else.
      tried: draft?.tried ?? [],
      // The look and colour picked in this edit, which new notes start with once it's saved with them.
      chosen: { ...draft?.chosen },
      // One key for a public note moving to this copy, however often the move is retried.
      moveKey: draft?.moveKey ?? null,
      // Which edit a kept draft belongs to.
      token: {},
      original,
      x: value.x,
      y: value.y,
      text: value.text,
      look: value.look,
      color: value.color,
      saving: false,
    };
    parts.field.value = value.text;
    dragging = null;
    pins.inert = true;
    layer.classList.add("tpn-editing");
    layer.append(parts.editor);
    renderPins();
    applyEditor();
    const focus = () => {
      if (editing?.field !== parts.field) return;
      parts.field.focus({ preventScroll: true });
      parts.field.setSelectionRange(parts.field.value.length, parts.field.value.length);
    };
    focus();
    menuGone?.then(focus);
  }

  function tool(name, label, onClick) {
    const control = el("button", "tpn-tool");
    control.append(icon(name));
    control.setAttribute("aria-label", label);
    control.title = label;
    control.addEventListener("click", onClick);
    return control;
  }

  function buildEditor() {
    const editor = themed(thingport, el("div", "tpn-editor"));
    const pin = el("span", "tpn-note tpn-bubble tpn-edit-pin");
    pin.setAttribute("aria-hidden", "true");
    pin.append(icon("lines"));
    const surface = el("div", "tpn-surface");
    const grip = el("button", "tpn-grip");
    grip.append(icon("grip"));
    grip.setAttribute("aria-label", t("editor.move"));
    grip.title = t("editor.dragHint");
    const text = el("textarea");
    text.maxLength = LIMIT;
    text.rows = 3;
    text.placeholder = t("editor.placeholder");
    text.setAttribute("aria-label", t("editor.text"));
    const tail = el("span", "tpn-tail");
    surface.append(grip, text, tail);

    const toolbar = el("div", "tpn-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", t("editor.options"));
    // Compact, only the chosen one of each pair shows, and choosing it again picks the other.
    const pick = (chosen, current, other) => (editing.compact && chosen === current ? other : chosen);
    const pair = (control) => (control.classList.add("tpn-pair"), control);
    // The button pressed may hide as the other choice shows: focus follows to it rather than being lost.
    const keepFocus = (group) => {
      const active = document.activeElement;
      if (active && active !== document.body && active.offsetParent !== null) return;
      Object.values(group)
        .find((control) => control.getAttribute("aria-pressed") === "true")
        ?.focus();
    };
    const looks = {
      bubble: pair(
        tool("bubble", t("editor.bubble"), () => {
          setLook(pick("bubble", editing.look, "sticky"));
          keepFocus(looks);
        }),
      ),
      sticky: pair(
        tool("sticky", t("editor.sticky"), () => {
          setLook(pick("sticky", editing.look, "bubble"));
          keepFocus(looks);
        }),
      ),
    };
    const audience = {
      personal: pair(
        tool("lock", t("editor.personal"), () => {
          setAudience(pick(false, editing.isPublic, true));
          keepFocus(audience);
        }),
      ),
      public: pair(
        tool("globe", t("editor.public"), () => {
          setAudience(pick(true, editing.isPublic, false));
          keepFocus(audience);
        }),
      ),
    };
    const swatches = el("span", "tpn-swatches");
    const colors = Object.fromEntries(
      COLORS.map((color) => {
        const swatch = el("button", "tpn-swatch tpn-c-" + color);
        const label = t("editor.color", { color: t("color." + color) });
        swatch.setAttribute("aria-label", label);
        swatch.title = label;
        swatch.addEventListener("click", () => {
          const next = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
          choose("color", pick(color, editing.color, next));
          applyEditor();
          keepFocus(colors);
        });
        swatches.append(swatch);
        return [color, swatch];
      }),
    );
    const colorSep = el("span", "tpn-sep");
    const cancel = tool("close", t("editor.cancel"), () => cancelEdit());
    const save = el("button", "tpn-save");
    save.append(icon("check"), el("span", "", t("editor.save")));
    save.addEventListener("click", () => saveEdit());
    toolbar.append(
      looks.bubble,
      looks.sticky,
      el("span", "tpn-sep"),
      audience.personal,
      audience.public,
      colorSep,
      swatches,
      el("span", "tpn-sep"),
      cancel,
      save,
    );
    const hint = el("div", "tpn-hint");
    hint.append(icon("grip"), el("span", "", t("editor.dragHint")));
    editor.append(pin, surface, toolbar, hint);

    text.addEventListener("input", () => {
      editing.text = text.value;
      applyEditor();
    });
    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        saveEdit();
      }
    });
    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    });
    grip.addEventListener("keydown", (event) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!step) return;
      event.preventDefault();
      const distance = event.shiftKey ? 0.1 : 0.02;
      const { width, height } = size();
      const shown = shownSpot(editing, width, height);
      moveTo(shown.x / width + step[0] * distance, shown.y / height + step[1] * distance);
    });
    for (const handle of [grip, pin, surface]) dragFrom(handle);
    return {
      editor,
      pin,
      surface,
      grip,
      field: text,
      toolbar,
      looks,
      audience,
      swatches,
      colors,
      colorSep,
      cancel,
      save,
      hint,
    };
  }

  /** A look or colour picked on the toolbar: one that changes the note counts as a choice. */
  function choose(field, value) {
    if (editing[field] !== value) editing.chosen[field] = value;
    editing[field] = value;
  }

  function setLook(look) {
    choose("look", look);
    applyEditor();
    moveTo(editing.x, editing.y);
  }

  function setAudience(isPublic) {
    if (editing.note || editing.tried.length) return;
    editing.isPublic = isPublic;
    applyEditor();
  }

  function applyEditor() {
    const e = editing;
    const sticky = e.look === "sticky";
    e.surface.className = "tpn-surface " + (sticky ? "tpn-is-sticky tpn-c-" + e.color : "tpn-is-bubble");
    e.pin.hidden = sticky;
    e.pin.classList.toggle("tpn-public", e.isPublic);
    e.surface.lastElementChild.hidden = sticky;
    for (const [look, control] of Object.entries(e.looks))
      control.setAttribute("aria-pressed", String(look === e.look));
    for (const [name, control] of Object.entries(e.audience)) {
      control.setAttribute("aria-pressed", String((name === "public") === e.isPublic));
      control.disabled = e.saving || Boolean(e.note || e.tried.length);
      if (e.note || e.tried.length) control.title = t(e.note ? "editor.visibilityFixed" : "editor.visibilitySent");
    }
    e.swatches.hidden = e.colorSep.hidden = !sticky;
    for (const [color, swatch] of Object.entries(e.colors))
      swatch.setAttribute("aria-pressed", String(color === e.color));
    for (const control of [...Object.values(e.looks), ...Object.values(e.colors), e.cancel, e.grip])
      control.disabled = e.saving;
    e.field.disabled = e.saving;
    e.save.disabled = e.saving || !e.field.value.trim();
    layoutEditor();
  }

  function layoutEditor(textLimit) {
    const e = editing;
    if (!e) return;
    const { width, height } = size();
    if (!width) return;
    e.surface.style.width = editorWidth(width, e.look) + "px";
    // The text grows with what's written, up to the textarea's own limit, or less on a picture too short for it.
    e.field.style.maxHeight = textLimit ? textLimit + "px" : "";
    e.field.style.minHeight = textLimit ? Math.min(58, textLimit) + "px" : "";
    e.field.style.height = "auto";
    e.field.style.height = e.field.scrollHeight + "px";
    const surface = { width: e.surface.offsetWidth, height: e.surface.offsetHeight };
    let group;
    if (e.look === "sticky") {
      const range = spotRange("sticky", width, height, surface);
      const left = clamp(e.x * width, ...range.x) - surface.width / 2;
      const top = clamp(e.y * height, ...range.y) - 6;
      Object.assign(e.surface.style, { left: left + "px", top: top + "px" });
      group = { left, top, width: surface.width, height: surface.height };
    } else {
      const pin = e.pin.offsetWidth;
      const range = spotRange("bubble", width, height, { width: pin, height: pin });
      const x = clamp(e.x * width, ...range.x);
      const y = clamp(e.y * height, ...range.y);
      const pinTop = y - bubbleTip(pin) - pin / 2;
      Object.assign(e.pin.style, { left: x - pin / 2 + "px", top: pinTop + "px" });
      const pinRect = { left: x - pin / 2, top: pinTop - 6, width: pin, height: y - pinTop + 6 };
      const place = beside(pinRect, surface, width, height, 10);
      Object.assign(e.surface.style, { left: place.left + "px", top: place.top + "px" });
      e.surface.dataset.side = place.side;
      e.surface.style.setProperty("--tpn-tail", clamp(x - place.left, 14, surface.width - 14) + "px");
      const top = Math.min(place.top, pinRect.top);
      const bottom = Math.max(place.top + surface.height, y);
      group = { left: Math.min(place.left, pinRect.left), top, width: surface.width, height: bottom - top };
    }
    // A toolbar too wide for the picture shows each choice as one button instead of a row.
    e.toolbar.classList.remove("tpn-compact");
    e.toolbar.classList.add("tpn-measure");
    e.compact = e.toolbar.offsetWidth > width - 2 * EDGE;
    e.toolbar.classList.remove("tpn-measure");
    e.toolbar.classList.toggle("tpn-compact", e.compact);
    const bar = { width: e.toolbar.offsetWidth, height: e.toolbar.offsetHeight };
    const left = clamp(group.left + group.width / 2 - bar.width / 2, EDGE, width - bar.width - EDGE);
    const below = group.top + group.height + 8;
    const above = group.top - 8 - bar.height;
    const fitsBelow = below + bar.height <= height - EDGE;
    if (!fitsBelow && above < EDGE) {
      const text = e.field.offsetHeight;
      if (text > MIN_TEXT && !(textLimit <= MIN_TEXT)) return layoutEditor(Math.max(MIN_TEXT, text - 16));
      // Still no room on either side: the note sits just above the toolbar at the foot of the picture, which overlaps
      // only on a picture shorter than the two of them at their smallest.
      const foot = height - EDGE - bar.height;
      const sits = Math.max(EDGE, foot - 8 - e.surface.offsetHeight);
      Object.assign(e.surface.style, { top: sits + "px" });
      e.surface.dataset.side = "over";
      Object.assign(e.toolbar.style, { left: left + "px", top: foot + "px" });
      return;
    }
    const top = fitsBelow ? below : above >= EDGE ? above : height - bar.height - EDGE;
    Object.assign(e.toolbar.style, { left: left + "px", top: top + "px" });
  }

  /** The spot as the editor draws it, in pixels: a note saved at an edge is drawn whole, a little way in. */
  function shownSpot(e, width, height) {
    const box =
      e.look === "sticky"
        ? { width: e.surface.offsetWidth, height: e.surface.offsetHeight }
        : { width: e.pin.offsetWidth, height: e.pin.offsetWidth };
    const range = spotRange(e.look, width, height, box);
    return { x: clamp(e.x * width, ...range.x), y: clamp(e.y * height, ...range.y), range };
  }

  function moveTo(fx, fy) {
    const e = editing;
    const { width, height } = size();
    // While saving, the spot sent is the one kept.
    if (!e || !width || e.saving) return;
    const { range } = shownSpot(e, width, height);
    e.x = clamp(clamp(fx * width, ...range.x) / width, 0, 1);
    e.y = clamp(clamp(fy * height, ...range.y) / height, 0, 1);
    e.hint.classList.add("tpn-gone");
    layoutEditor();
  }

  function dragFrom(handle) {
    handle.addEventListener("pointerdown", (event) => {
      const e = editing;
      if (!e || e.saving || dragging !== null || event.button !== 0 || event.target.closest("textarea")) return;
      // The grip is inside the note: one drag, not two.
      event.preventDefault();
      event.stopPropagation();
      const pointer = event.pointerId;
      dragging = pointer;
      const box = layer.getBoundingClientRect();
      const shown = shownSpot(e, box.width, box.height);
      const offset = { x: event.clientX - box.left - shown.x, y: event.clientY - box.top - shown.y };
      handle.setPointerCapture(pointer);
      layer.classList.add("tpn-dragging");
      // Only the pointer that started it moves the note or ends the drag; a second finger does neither.
      const move = (next) => {
        if (next.pointerId !== pointer) return;
        const now = layer.getBoundingClientRect();
        moveTo((next.clientX - now.left - offset.x) / now.width, (next.clientY - now.top - offset.y) / now.height);
      };
      const end = (last) => {
        if (last.pointerId !== pointer) return;
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.removeEventListener(type, end);
        handle.removeEventListener("pointermove", move);
        if (dragging === pointer) dragging = null;
        layer.classList.remove("tpn-dragging");
        if (editing === e && handle !== e.grip) e.field.focus({ preventScroll: true });
      };
      handle.addEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, end);
    });
  }

  async function cancelEdit() {
    const e = editing;
    if (!e || e.saving) return;
    // A new note with nothing written couldn't be saved anyway.
    if (changedFields(e).length && (e.note || e.text.trim())) {
      const discard = await ui.confirm({
        title: t("editor.discardTitle"),
        message: t("editor.discardMessage"),
        confirmLabel: t("editor.discard"),
        destructive: true,
      });
      if (!discard || !alive || editing !== e) {
        if (editing === e) e.field.focus({ preventScroll: true });
        return;
      }
    }
    endEdit(e.note);
  }

  function endEdit(focusNote) {
    const e = editing;
    editing = null;
    e.editor.remove();
    dragging = null;
    pins.inert = false;
    layer.classList.remove("tpn-editing");
    renderPins();
    const target = focusNote && [...pins.children].find((element) => element.dataset.id === noteId(focusNote));
    (target ?? button).focus({ preventScroll: true });
    if (readyDraft()) void load();
  }

  async function saveEdit() {
    const e = editing;
    const text = e?.text.trim();
    if (!text || e.saving) return;
    e.saving = true;
    const value = { x: e.x, y: e.y, text, look: e.look, color: e.color };
    const tried = e.tried;
    applyEditor();
    // Taken now, as the save may finish after the picture changes.
    const chosen = { ...e.chosen };
    const pickedAt = ++picks;
    if (e.isPublic && e.note && e.note.modelId && e.note.modelId !== modelId)
      e.moveKey ??= newNoteKey(modelId, preview.key);
    try {
      const draft = {
        key: e.key,
        public: e.isPublic,
        modelId: e.note?.modelId,
        existing: Boolean(e.note),
        original: e.original,
        tried,
        // Once it's written, this save joins the ones before it until it's known to have gone through, or not to have:
        // a read failing first sends nothing.
        onSend: () => {
          e.tried = [...tried, value];
          const kept = drafts.get(draftKey)?.get(e.token);
          if (kept) kept.tried = e.tried;
        },
      };
      const saved = await saveNote(thingport, draft, value, modelId, e.moveKey);
      // Saved, even if the picture changed meanwhile: a draft kept for it is spent, and what was picked is remembered.
      dropDraft(e);
      if (saved.leftover) ui.toast(t("editor.oldCopy"), "warning");
      // Only a look or colour picked in this edit becomes the next note's, each on its own, and only as the note was
      // saved with it: neither a default standing in for unread settings nor a change made somewhere else counts.
      const picked = Object.fromEntries(
        Object.entries(chosen).filter(([field, choice]) => saved.value[field] === choice),
      );
      settings.pickedAt ??= {};
      const newest = Object.fromEntries(
        Object.entries(picked).filter(([field]) => (settings.pickedAt[field] ?? 0) < pickedAt),
      );
      for (const field of Object.keys(newest)) settings.pickedAt[field] = pickedAt;
      // Written even when the view already says so: that may be a default standing in for unread settings, or a pick
      // whose write failed.
      if (Object.keys(newest).length) setView(newest);
      if (!alive || editing !== e) return;
      const moved = saved.key !== e.key;
      const note = {
        ...(e.note ?? ownNote(e)),
        ...(moved ? { key: saved.key, modelId } : {}),
        value: noteValue(saved.value),
        updatedAt: new Date().toISOString(),
      };
      // An edit that came back for a note this picture doesn't list, as one from another copy while the pictures can't
      // be compared, isn't drawn here: the reload its save set off has the say.
      const listed = !e.note || moved || notes.some((other) => noteId(other) === noteId(e.note));
      if (listed) {
        const replaced = [noteId(note), ...(e.note ? [noteId(e.note)] : [])];
        notes = [note, ...notes.filter((other) => !replaced.includes(noteId(other)))];
      }
      endEdit(listed ? note : null);
    } catch (error) {
      if (error instanceof NoteGone) {
        dropDraft(e);
        ui.toast(t("editor.deleted"), "warning");
        if (alive && editing === e) {
          // Not drawn again once the editor closes.
          if (e.note) notes = notes.filter((note) => noteId(note) !== noteId(e.note));
          endEdit(null);
        }
        return;
      }
      if (error instanceof NoteChanged) {
        // Changed here and somewhere else since it was opened, or for a new note since it was sent: the editor stays,
        // now measured against the note as it is, so saving again replaces the other change. What this edit didn't
        // change takes the stored value. A new note found stored is from now on an edit of it, and a moved one an edit
        // of its new copy.
        Object.assign(e, rebaseEdit(value, e.note ? e.original : tried[0], error.stored, tried));
        if (e.field.value.trim() !== e.text) e.field.value = e.text;
        e.original = error.stored;
        e.tried = [];
        e.note = { ...(e.note ?? ownNote(e)), value: error.stored };
        if (error.key !== e.key) {
          e.note = { ...e.note, key: error.key, modelId };
          e.key = error.key;
          e.moveKey = null;
        }
        ui.toast(t("editor.conflict"), "warning");
        // The picture shows the note as it's stored, and a new one its lost answer never drew.
        if (alive) void load();
        // A draft kept for the picture, if it changed meanwhile, is now this edit as it stands.
        if (drafts.get(draftKey)?.has(e.token)) {
          keepDraft(e, false);
          draftsFreed.dispatchEvent(new CustomEvent("freed", { detail: draftKey }));
        }
        return;
      }
      // Said even when the picture has changed meanwhile: the edit waits there, kept as a draft.
      ui.toast(t("editor.saveFailed"), "error");
      const kept = drafts.get(draftKey)?.get(e.token);
      if (kept) {
        kept.saving = false;
        draftsFreed.dispatchEvent(new CustomEvent("freed", { detail: draftKey }));
      }
    } finally {
      if (editing === e) {
        e.saving = false;
        applyEditor();
      }
    }
  }

  function render() {
    renderButton();
    renderPins();
    if (!reading) return;
    const current = notes.find((note) => noteId(note) === reading.element.dataset.id);
    if (!current || settings.view.hidden || !reading.element.isConnected) closeRead(false);
    else {
      fillRead(current);
      layoutRead();
    }
  }

  async function load() {
    if (!preview) return;
    const run = ++revision;
    try {
      const next = await readNotes(thingport, { model: modelId, preview: preview.key });
      if (!alive || run !== revision) return;
      notes = next;
      render();
      await endIfGone(editing);
      await restoreDraft();
    } catch {
      if (alive && run === revision) ui.toast(t("board.error"), "error");
    }
  }

  // An edit of a note deleted on this page, as in the Notes window, ends and says so. One deleted in another tab isn't
  // heard here: saving it then finds it gone instead of writing it back. Missing from the picture's notes isn't enough:
  // one from another copy shows only while the pictures can be compared, so where it's kept has the last word.
  async function endIfGone(e) {
    if (!e?.note || e.saving || notes.some((note) => noteId(note) === noteId(e.note))) return;
    const stored = await storedNote(thingport, e.note).catch(() => undefined);
    if (stored !== null || !alive || editing !== e || e.saving) return;
    dropDraft(e);
    endEdit(null);
    ui.toast(t("editor.deleted"), "warning");
  }

  const observer =
    layer &&
    new ResizeObserver(() => {
      layoutPins();
      layoutRead();
      layoutEditor();
    });
  observer?.observe(layer);
  document.addEventListener("pointerdown", onPointerDown, true);
  const stop = onNotesChange(thingport, load);
  renderButton();
  void load();
  return () => {
    alive = false;
    settings.listeners.delete(onSettings);
    draftsFreed.removeEventListener("freed", onDraftFreed);
    // An unsaved edit waits for the picture to come back, as does one a lost answer left unsure of; one still saving
    // waits too, in case the save fails.
    if (editing && (editing.saving || editing.tried.length || changedFields(editing).length))
      keepDraft(editing, editing.saving);
    stop();
    observer?.disconnect();
    document.removeEventListener("pointerdown", onPointerDown, true);
    layer?.remove();
  };
}
