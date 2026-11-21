// Where notes are kept and how they're read back: personal ones in `storage`, public ones in `shared`, each under a
// key of `note:<model>:<preview>:<random>`, plus the viewer's own view settings.

export const PREFIX = "note:";
export const LIMIT = 500;
export const LOOKS = ["bubble", "sticky"];
export const COLORS = ["yellow", "pink", "blue", "green"];
const VIEW_KEY = "view";
export const personalChanges = new EventTarget();

/** A stored value as the notes are drawn, or null when it isn't a note. Notes from before looks show as bubbles. */
export function noteValue(value) {
  if (typeof value?.text !== "string" || !value.text.length || value.text.length > LIMIT) return null;
  if (![value.x, value.y].every((point) => Number.isFinite(point) && point >= 0 && point <= 1)) return null;
  return {
    x: value.x,
    y: value.y,
    text: value.text,
    look: LOOKS.includes(value.look) ? value.look : "bubble",
    color: COLORS.includes(value.color) ? value.color : COLORS[0],
  };
}

export function newNoteKey(modelId, previewKey) {
  return PREFIX + modelId + ":" + previewKey + ":" + Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
}

/** The same note from any read: two people's public notes may share a key. */
export const noteId = (note) => (note.user?.id ?? "") + "/" + note.key;

async function readPublicNotes(shared, options) {
  const notes = [];
  let before;
  for (;;) {
    const page = await shared.list({ ...options, before });
    notes.push(...page);
    if (page.length < 5000) return notes;
    before = page.at(-1).cursor;
  }
}

async function readPersonalNotes(storage, prefix) {
  const keys = (await storage.keys()).filter((key) => key.startsWith(prefix));
  const notes = [];
  for (let i = 0; i < keys.length; i += 8) {
    notes.push(
      ...(await Promise.all(
        keys.slice(i, i + 8).map(async (key) => {
          const value = await storage.get(key);
          return { key, value, mine: true, modelId: key.split(":")[1], updatedAt: value?.updatedAt };
        }),
      )),
    );
  }
  return notes;
}

/**
 * On a preview, everyone's notes on it that reach the viewer; without one, only the viewer's own, for the board.
 * Newest first.
 */
export async function readNotes({ shared, storage }, { model, preview } = {}) {
  const personalPrefix = preview ? PREFIX + model + ":" + preview + ":" : PREFIX;
  const [personal, publicNotes] = await Promise.all([
    readPersonalNotes(storage, personalPrefix),
    readPublicNotes(shared, { prefix: PREFIX, model, preview }),
  ]);
  const matchingPublic = preview
    ? publicNotes.filter((note) => note.previewMatch ?? note.key.startsWith(personalPrefix))
    : publicNotes;
  return [...personal, ...matchingPublic.map((note) => ({ ...note, public: true }))]
    .filter((note) => model || note.mine)
    .map((note) => ({ ...note, value: noteValue(note.value) }))
    .filter((note) => note.value)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

/**
 * Keeps a note where its visibility says, under its key: a retry overwrites rather than adding a second one. Returns
 * the key it's kept under, and whether an older copy of it was left shared.
 */
export async function saveNote({ shared, storage }, note, value, modelId, previewKey) {
  const contents = { x: value.x, y: value.y, text: value.text, look: value.look, color: value.color };
  if (!note.public) {
    await storage.set(note.key, { ...contents, updatedAt: new Date().toISOString() });
    personalChanges.dispatchEvent(new Event("change"));
    return { key: note.key, leftover: false };
  }
  // A public note stays tied to the model its key names, which is how copies of that model find it.
  const written = note.modelId ?? modelId;
  try {
    await shared.set(note.key, contents, { model: written });
    return { key: note.key, leftover: false };
  } catch (error) {
    // Edited on another copy after its writer lost the model it was on: it moves to this copy, under a key naming it.
    // The new one is written first, so a failure along the way leaves a second copy rather than none.
    if (written === modelId || !previewKey) throw error;
    const key = newNoteKey(modelId, previewKey);
    await shared.set(key, contents, { model: modelId });
    const leftover = await shared.remove(note.key).then(
      () => false,
      () => true,
    );
    return { key, leftover };
  }
}

export function onNotesChange(thingport, listener) {
  personalChanges.addEventListener("change", listener);
  const stop = thingport.shared.onChange(listener);
  return () => {
    personalChanges.removeEventListener("change", listener);
    stop();
  };
}

export async function confirmRemove({ ui, shared, storage, t }, note) {
  const confirmed = await ui.confirm({
    title: t("note.deleteTitle"),
    message: t("note.deleteMessage"),
    confirmLabel: t("note.delete"),
    destructive: true,
  });
  if (!confirmed) return false;
  if (note.public) await shared.remove(note.key);
  else {
    await storage.remove(note.key);
    personalChanges.dispatchEvent(new Event("change"));
  }
  return true;
}

/** Whether notes are hidden on pictures, and the look and colour a new note starts with: the last ones saved. */
export async function readView(storage) {
  const view = await storage.get(VIEW_KEY).catch(() => null);
  return {
    hidden: view?.hidden === true,
    look: LOOKS.includes(view?.look) ? view.look : "sticky",
    color: COLORS.includes(view?.color) ? view.color : COLORS[0],
  };
}

export const writeView = (storage, view) => storage.set(VIEW_KEY, view);

/** How long ago, in the user's language; `now` under a minute, which reads better than "this minute". */
export function ago(iso, language, now) {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (Math.abs(seconds) < 60) return now;
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return now;
}

export function initials(name) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toLocaleUpperCase())
    .join("");
}
