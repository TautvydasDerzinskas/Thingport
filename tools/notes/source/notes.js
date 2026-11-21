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

/** Thrown by `saveNote` for an edit of a note deleted since it was opened: it isn't written back. */
export class NoteGone extends Error {}

/**
 * Thrown by `saveNote` for an edit whose changed fields were also changed somewhere else since it was opened. `stored`
 * is the note as it is now, for the editor to start from; saving again replaces those changes.
 */
export class NoteChanged extends Error {
  constructor(stored) {
    super("The note changed somewhere else");
    this.stored = stored;
  }
}

const FIELDS = ["x", "y", "text", "look", "color"];

/**
 * The viewer's note as it's kept under its key now, or null when it's gone; a failed read throws. Not the same as
 * missing from a picture's notes: one from another copy shows there only while the pictures can be compared.
 */
export async function storedNote({ shared, storage }, note) {
  if (!note.public) return noteValue(await storage.get(note.key));
  const entries = await shared.list({ prefix: note.key });
  return noteValue(entries.find((entry) => entry.mine && entry.key === note.key)?.value);
}

/** An edit re-based after a `NoteChanged`: the fields it changed stay as it has them, the rest take the stored ones. */
export const rebaseEdit = (edit, original, stored) =>
  Object.fromEntries(FIELDS.map((field) => [field, edit[field] !== original[field] ? edit[field] : stored[field]]));

/**
 * Keeps a note where its visibility says, under its key, so a retry overwrites rather than adding a second one.
 * An edit (`existing`, with the `original` it was opened from) writes only the fields it changed onto the note as
 * stored now, so a change made somewhere else to the others, as in another tab, stays. It throws `NoteGone` for a
 * note deleted meanwhile, and `NoteChanged` when a field it changed was changed there too.
 * A public note edited on another copy after its writer lost the model it was on moves to `moveKey`, on this copy:
 * pass the same one to a retry of the move. Returns the key it's kept under, the value written, and whether an older
 * copy was left.
 */
export async function saveNote(thingport, note, value, modelId, moveKey) {
  const { shared, storage, api } = thingport;
  let contents = Object.fromEntries(FIELDS.map((field) => [field, value[field]]));
  if (note.existing) {
    const stored = await storedNote(thingport, note);
    if (!stored) throw new NoteGone();
    const changed = FIELDS.filter((field) => value[field] !== note.original[field]);
    // A field already as this edit asks, as after a save whose answer was lost, isn't a conflict.
    if (changed.some((field) => stored[field] !== note.original[field] && stored[field] !== value[field]))
      throw new NoteChanged(stored);
    contents = { ...Object.fromEntries(FIELDS.map((field) => [field, stored[field]])), ...pick(value, changed) };
  }
  if (!note.public) {
    await storage.set(note.key, { ...contents, updatedAt: new Date().toISOString() });
    personalChanges.dispatchEvent(new Event("change"));
    return { key: note.key, value: contents, leftover: false };
  }
  // A public note stays tied to the model its key names, which is how copies of that model find it.
  const written = note.modelId ?? modelId;
  try {
    await shared.set(note.key, contents, { model: written });
    return { key: note.key, value: contents, leftover: false };
  } catch (error) {
    if (written === modelId || !moveKey) throw error;
    // Only a model its writer can't open any more moves the note; any other failure is the caller's to retry. The
    // model's licence answers that the way the write does, without counting as a visit to the model.
    const res = await api("/print/" + encodeURIComponent(written) + "/license").catch(() => null);
    if (!res || ![403, 404].includes(res.status)) throw error;
    // The new copy is written first, so a failure along the way leaves two copies rather than none.
    await shared.set(moveKey, contents, { model: modelId });
    const leftover = await shared.remove(note.key).then(
      () => false,
      () => true,
    );
    return { key: moveKey, value: contents, leftover };
  }
}

const pick = (value, fields) => Object.fromEntries(fields.map((field) => [field, value[field]]));

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

/**
 * Whether notes are hidden on pictures, and the look and colour a new note starts with: the last ones saved, or the
 * defaults for a viewer who never saved any. A failed read throws, so it isn't taken for having none.
 */
export async function readView(storage) {
  const view = await storage.get(VIEW_KEY);
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
