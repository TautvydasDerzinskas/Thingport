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
 * is the note as it is now, for the editor to start from, and `key` where it's kept: a moved note's new key once its
 * move turned out done, with `leftover` saying whether its old copy is still shared. Saving again replaces those
 * changes.
 */
export class NoteChanged extends Error {
  constructor(stored, key, leftover = false) {
    super("The note changed somewhere else");
    this.stored = stored;
    this.key = key;
    this.leftover = leftover;
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

/** The fields an edit changes from `original`, now or in a save it sent before (`tried`). */
const touchedFields = (edit, original, tried = []) =>
  FIELDS.filter((field) => [edit, ...tried].some((sent) => sent[field] !== original[field]));

/**
 * An edit re-based after a `NoteChanged`: the fields it changed, now or in a save it sent before, stay as it has them;
 * the rest take the stored ones.
 */
export const rebaseEdit = (edit, original, stored, tried = []) => {
  const touched = touchedFields(edit, original, tried);
  return Object.fromEntries(FIELDS.map((field) => [field, touched.includes(field) ? edit[field] : stored[field]]));
};

/**
 * What an edit's earlier saves sent, for a draft of it coming back onto the note as stored now, which becomes its
 * original: the fields it changed (`fields`) keep what was sent, and the rest take the stored values, so a later change
 * made somewhere else back to the old value isn't taken for one of the edit's own writes.
 */
export const restoredTried = (tried, stored, fields) => tried.map((sent) => ({ ...stored, ...pick(sent, fields) }));

/**
 * Keeps a note where its visibility says, under its key, so a retry overwrites rather than adding a second one.
 * An edit (`existing`, with the `original` it was opened from) is written onto the note as stored now: a field changed
 * somewhere else, as in another tab, stays when the edit never changed it, and is a `NoteChanged` when it did. It
 * throws `NoteGone` for a note deleted meanwhile.
 * `tried` lists what the editor's earlier saves sent, each of which may have gone through with its answer lost: a
 * stored value one of them sent isn't a change made somewhere else. A new note with any is looked for under its key
 * and taken as an edit of the first; one not found is written afresh. `onSend` is called with the key this save
 * writes first, as it starts writing, when its value joins those.
 * A public note edited on another copy after its writer lost the model it was on moves to `moveKey`, on this copy:
 * pass the same one to a retry of the move. A move whose new copy turns out written is finished there. `oldCopy`, the
 * old key and the values this editor knew it to hold, is what's left to clean up once the move is done, however the
 * editor came to be at the new copy: it's removed only as this editor left it, and one changed since, or that can't be
 * read, is left. Returns the key it's kept under, the value written, and whether an older copy was left.
 */
export async function saveNote(thingport, note, value, modelId, moveKey) {
  const { shared, storage, api } = thingport;
  const tried = note.tried ?? [];
  // A move sent before may have written the new copy with its answer lost: then that copy is the note now.
  const movable = note.public && note.existing && moveKey && moveKey !== note.key;
  const moved = movable && tried.length ? await storedNote(thingport, { public: true, key: moveKey }) : null;
  // The old copy a finished move leaves to clean up: this save's own once it's at the new copy.
  const oldCopy = moved ? (note.oldCopy ?? { key: note.key, values: [note.original, ...tried] }) : note.oldCopy;
  const cleanUp = () =>
    oldCopy && oldCopy.key !== (moved ? moveKey : note.key) ? dropOldCopy(thingport, oldCopy) : false;
  let contents = pick(value, FIELDS);
  const stored = moved ?? (note.existing || tried.length ? await storedNote(thingport, note) : null);
  if (note.existing && !stored) throw new NoteGone();
  if (stored) {
    const original = note.existing ? note.original : tried[0];
    // Changed somewhere else: neither what it was, nor what this editor sent, nor already as this edit asks.
    const theirs = FIELDS.filter((field) => ![original, value, ...tried].some((sent) => sent[field] === stored[field]));
    const touched = touchedFields(value, original, tried);
    if (theirs.some((field) => touched.includes(field))) {
      // A move that's done leaves its old copy to clean up either way.
      throw new NoteChanged(stored, moved ? moveKey : note.key, await cleanUp());
    }
    contents = { ...contents, ...pick(stored, theirs) };
  }
  note.onSend?.(moved ? moveKey : note.key, contents);
  if (moved) {
    await shared.set(moveKey, contents, { model: modelId });
    return { key: moveKey, value: contents, leftover: await cleanUp() };
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
    return { key: note.key, value: contents, leftover: await cleanUp() };
  } catch (error) {
    if (written === modelId || !moveKey) throw error;
    // Only a model its writer can't open any more moves the note; any other failure is the caller's to retry. The
    // model's licence answers that the way the write does, without counting as a visit to the model.
    const res = await api("/print/" + encodeURIComponent(written) + "/license").catch(() => null);
    if (!res || ![403, 404].includes(res.status)) throw error;
    // The new copy is written first, so a failure along the way leaves two copies rather than none. The old one then
    // goes only as this save found it, as it was written, or as this editor knew it.
    await shared.set(moveKey, contents, { model: modelId });
    const known = [...(note.oldCopy?.values ?? []), stored, contents];
    return { key: moveKey, value: contents, leftover: await dropOldCopy(thingport, { key: note.key, values: known }) };
  }
}

/**
 * Removes the old copy of a moved note, but only as this editor left it, holding the whole of one of `values`: saved to
 * since, as once its model can be opened again, or unreadable, it stays. Says whether one is left.
 */
async function dropOldCopy(thingport, { key, values }) {
  const old = await storedNote(thingport, { public: true, key }).catch(() => undefined);
  if (old === null) return false;
  const untouched = old && values.some((known) => known && FIELDS.every((field) => known[field] === old[field]));
  if (!untouched) return true;
  return thingport.shared.remove(key).then(
    () => false,
    () => true,
  );
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
