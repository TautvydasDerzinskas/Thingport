// The shelf without a window: what a spool holds, which filaments a model needs, and who has a spool that matches
// each one. Everything here is plain data, so it's tested on its own (test_shelf.mjs).

import { colourDistance, isHex, normaliseHex } from "./colour.js";

/** A spool's key among the user's shared entries. */
export const SPOOL = "spool:";
/** A model's filaments as someone edited them, one entry per person and model. */
export const NEEDS = "needs:";

/** CIEDE2000 up to which a spool's colour counts as the same as the one needed, and up to which as close. */
export const SAME = 6;
export const CLOSE = 15;

/** How much is left on a spool, when it isn't weighed. */
export const AMOUNTS = ["full", "half", "low"];
/** The materials the spool dialog offers as buttons; anything else is typed. */
export const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU"];
/** Brands suggested while typing one, after the ones the household has. */
export const BRANDS = [
  "Bambu Lab",
  "Polymaker",
  "eSUN",
  "Prusament",
  "Sunlu",
  "Elegoo",
  "Overture",
  "Jayo",
  "Creality",
  "Anycubic",
  "Eryone",
  "Kingroon",
  "Fiberlogy",
  "Spectrum",
  "Extrudr",
  "Fillamentum",
  "Das Filament",
  "ColorFabb",
  "Hatchbox",
  "Inland",
  "Atomic",
  "Proto-pasta",
];

/** A short id, without crypto.randomUUID, which a Thingport instance on plain http doesn't have. */
export function newId(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}${random().toString(36).slice(2, 8)}`;
}

// A name as a word among others: "PLA" in "PLA+", "Silk PLA" or "PLA-CF", not in "PLAY"; digits may touch it ("PA12").
const word = (name) => new RegExp(`(?:^|[^A-Z])${name}(?:[^A-Z]|$)`);
const FAMILIES = [
  ["PETG", [word("PETG")]],
  ["PLA", [word("PLA")]],
  ["ASA", [word("ASA")]],
  ["ABS", [word("ABS")]],
  ["TPU", [word("TPU")]],
  ["PC", [word("PC")]],
  ["PA", [word("PA"), word("PAHT"), /NYLON/]],
  ["PVA", [word("PVA")]],
  ["HIPS", [word("HIPS")]],
];
export const FAMILY_NAMES = FAMILIES.map(([name]) => name);

/** The material family a name belongs to, so "PLA Matte" matches "PLA+": a name it doesn't know is its own family.
 *  Null for no name, which matches any material. */
export function family(type) {
  if (typeof type !== "string") return null;
  const name = type
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/PET[ -]G/, "PETG");
  if (!name) return null;
  for (const [known, patterns] of FAMILIES) if (patterns.some((pattern) => pattern.test(name))) return known;
  return name;
}

const isText = (value, max = 200) => typeof value === "string" && value.length <= max;
const isGrams = (value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 100000);

/** Whether a shared value is a spool this tool wrote, whole: anyone can write anything under its key. */
export function isSpool(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isText(value.brand) &&
    isText(value.line) &&
    isText(value.material) &&
    value.material.trim() !== "" &&
    isText(value.colorName) &&
    isHex(value.color) &&
    (value.left === null || AMOUNTS.includes(value.left)) &&
    isGrams(value.grams) &&
    isText(value.note, 2000)
  );
}

/** A spool as it's stored, from what the dialog holds. */
export function spoolValue({
  brand = "",
  line = "",
  material,
  colorName = "",
  color,
  left = null,
  grams = null,
  note = "",
}) {
  return {
    brand: brand.trim(),
    line: line.trim(),
    material: material.trim(),
    colorName: colorName.trim(),
    color: normaliseHex(color),
    left: grams === null ? left : null,
    grams,
    note: note.trim(),
  };
}

/** How full a spool's bar is, 0 to 100, or null when nobody said. Weighed, against a 1 kg spool. */
export function amountPercent(spool) {
  if (spool.grams !== null) return Math.max(0, Math.min(100, spool.grams / 10));
  return { full: 100, half: 50, low: 12 }[spool.left] ?? null;
}

/** Whose an entry is, as `people` keys them: the reader is "me" whether or not their own id is known. */
export const ownerKey = (entry) => (entry.mine ? "me" : `u:${entry.user.id}`);

/** Shared entries that are well-formed spools with someone behind them. */
export function spoolsOf(entries) {
  return entries.filter((entry) => entry.key.startsWith(SPOOL) && isSpool(entry.value) && (entry.mine || entry.user));
}

/** The reader, then everyone with a spool that reaches them, by name. The reader is `user` where Thingport says who's
 *  signed in, else whoever wrote any entry of theirs; with neither, only `mine` says who they are. */
export function people(entries, user = null) {
  const reader = user ?? entries.find((entry) => entry.mine && entry.user)?.user ?? null;
  const others = new Map();
  for (const entry of spoolsOf(entries)) {
    if (entry.mine) continue;
    const key = ownerKey(entry);
    if (!others.has(key)) others.set(key, { ...entry.user, key, mine: false });
  }
  const me = { id: reader?.id ?? null, name: reader?.name ?? null, avatarUrl: reader?.avatarUrl ?? null };
  return [
    { ...me, key: "me", mine: true },
    ...[...others.values()].toSorted((a, b) => String(a.name).localeCompare(String(b.name))),
  ];
}

const isNeed = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  (value.type === null || isText(value.type, 60)) &&
  (value.color === null || isHex(value.color)) &&
  isGrams(value.grams);

/** The most filaments an edit keeps: a longer list isn't read as one. */
export const MAX_FILAMENTS = 64;

/** Whether a shared value is an edit of a model's filaments for one of its profiles: a list, or null for "back to the
 *  profile". */
export function isNeedsValue(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    // A file's folder is up to 500 characters, its name up to 255.
    isText(value.profile, 1000) &&
    (value.filaments === null ||
      (Array.isArray(value.filaments) && value.filaments.length <= MAX_FILAMENTS && value.filaments.every(isNeed)))
  );
}

const timeOf = (iso) => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

/** Which profile of a model an edit is for: the provider's id where the file is one, which every copy of the model
 *  shares, else the file's folder and name, which a copy keeps; one name can be in two folders. */
export function profileKey(file) {
  if (!file) return "model";
  if (file.profile?.id) return `profile:${file.profile.id}`;
  return `file:${file.folder ? `${file.folder}/` : ""}${file.name}`;
}

/** The entry an edit of that profile is kept under. A key holds only a few kinds of character, so the profile's is
 *  hashed, twice over, 64 bits in all: two of one person's files sharing a key would lose one's edit to the other's. */
export function needsKey(modelId, profile) {
  let djb = 5381;
  let fnv = 0x811c9dc5;
  for (const char of profile) {
    const code = char.codePointAt(0);
    djb = ((djb * 33) ^ code) >>> 0;
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
  }
  return `${NEEDS}${modelId}:${djb.toString(36)}${fnv.toString(36).padStart(7, "0")}`;
}

/** The edit in force on a profile of a model: the newest anyone made, unless that one went back to the profile. */
export function currentEdit(entries, profile) {
  let newest = null;
  for (const entry of entries) {
    if (!entry.key.startsWith(NEEDS) || !isNeedsValue(entry.value) || !(entry.mine || entry.user)) continue;
    if (entry.value.profile !== profile) continue;
    if (!newest || timeOf(entry.updatedAt) > timeOf(newest.updatedAt)) newest = entry;
  }
  if (!newest || newest.value.filaments === null) return null;
  return { filaments: newest.value.filaments, user: newest.user, mine: newest.mine, updatedAt: newest.updatedAt };
}

/** The file whose filaments are shown: the one picked on the page, else the first that's a print profile. */
export function pickFile(model, fileId) {
  return model.files.find((file) => file.id === fileId) ?? model.files.find((file) => file.profile) ?? null;
}

const cleanType = (type) => (typeof type === "string" && type.trim() ? type.trim() : null);
const cleanGrams = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const sameFilament = (a, b) => family(a.type) === family(b.type) && normaliseHex(a.color) === normaliseHex(b.color);

/** The filaments a model needs: the edit in force, else the picked profile's. Each says which plates use it, where
 *  the profile has more than one. */
export function needsFor(model, fileId, edit) {
  const profile = pickFile(model, fileId)?.profile ?? null;
  const plates = profile?.plates ?? [];
  const list = edit ? edit.filaments : (profile?.filaments ?? []);
  return list.map((filament) => {
    const item = {
      type: cleanType(filament.type),
      color: normaliseHex(filament.color),
      grams: cleanGrams(filament.grams),
      brand: edit ? null : cleanType(filament.brand),
    };
    item.plates =
      plates.length > 1
        ? plates
            .filter((plate) => plate.filaments.some((other) => sameFilament(other, item)))
            .map((plate) => plate.index)
        : [];
    return item;
  });
}

/** How well a spool stands in for a needed filament: the same, close, or not at all (null). */
export function grade(needed, spool) {
  // Weighed at nothing: there's none of it left, however well it would match. An unweighed spool still counts.
  if (spool.grams === 0) return null;
  if (needed.type && family(needed.type) !== family(spool.material)) return null;
  if (!needed.color) return { grade: "same", delta: 0 };
  const delta = colourDistance(needed.color, spool.color);
  if (delta <= SAME) return { grade: "same", delta };
  if (delta <= CLOSE) return { grade: "close", delta };
  return null;
}

/** The spool among these that matches best: the same beats close, then the nearer colour. */
export function bestSpool(needed, spools) {
  let best = null;
  for (const entry of spools) {
    const match = grade(needed, entry.value);
    if (!match) continue;
    if (
      !best ||
      (match.grade === "same" && best.grade === "close") ||
      (match.grade === best.grade && match.delta < best.delta)
    )
      best = { entry, ...match };
  }
  return best;
}

/** Each needed filament against each person's spools: their best match, how many each has, and what nobody has. */
export function matchAll(needs, spools, everyone) {
  const byOwner = new Map(everyone.map((person) => [person.key, []]));
  for (const entry of spools) byOwner.get(ownerKey(entry))?.push(entry);
  const rows = needs.map((needed) => ({
    need: needed,
    cells: everyone.map((person) => bestSpool(needed, byOwner.get(person.key))),
  }));
  const missing = rows.filter((row) => !row.cells.some(Boolean)).map((row) => row.need);
  return {
    rows,
    counts: everyone.map((_, index) => rows.filter((row) => row.cells[index]).length),
    have: needs.length - missing.length,
    count: needs.length,
    missing,
  };
}

/** The needed filaments the user's own shelf has nothing for. */
export function missingOnShelf(needs, spools) {
  const mine = spools.filter((entry) => entry.mine);
  return needs.filter((needed) => !bestSpool(needed, mine));
}

/** A new spool for a needed filament, as the dialog starts it. */
export function prefillFor(needed) {
  const type = needed.type ?? "PLA";
  const known = family(type);
  const material = FAMILY_NAMES.includes(known) ? known : type;
  return {
    brand: needed.brand ?? "",
    line: type.toUpperCase() === material.toUpperCase() ? "" : type,
    material,
    colorName: "",
    color: needed.color ?? "#FFFFFF",
    left: "full",
    grams: null,
    note: "",
  };
}

/** A read of shared entries gives 5,000 at most, newest first. */
export const PAGE = 5000;

/** Every entry the options pick, read on page by page, so old spools can't fall off behind newer ones. */
export async function readAll(shared, options = {}, page = PAGE) {
  let read = await shared.list(options);
  const all = [...read];
  while (read.length >= page) {
    read = await shared.list({ ...options, before: read.at(-1).cursor });
    all.push(...read);
  }
  return all;
}

// What the parts of a page read, kept a moment: the tab and the badge draw at once, and share one read of each. Less
// than the 1.5 s the page waits between looks at profiles filling in, so parts drawn again once they have read anew.
const READ_FOR_MS = 1000;
const reads = new Map();
// A change already forgotten for: every part hears it, and the first to read again starts what the others share.
let forgetting = false;

function readOnce(key, read) {
  const now = Date.now();
  // Old ones go as new ones come, so moving from model to model keeps none of them.
  for (const [other, kept] of reads) if (now - kept.at >= READ_FOR_MS) reads.delete(other);
  const kept = reads.get(key);
  if (kept) return kept.promise;
  const promise = read();
  reads.set(key, { at: now, promise });
  promise.catch(() => {
    if (reads.get(key)?.promise === promise) reads.delete(key);
  });
  return promise;
}

/** Forgets every read, as a change on the page makes them old: once for each change, however many parts hear it, so
 *  the reads the first starts again are the others' too. */
export function forgetReads() {
  if (forgetting) return;
  forgetting = true;
  reads.clear();
  queueMicrotask(() => {
    forgetting = false;
  });
}

/** What a model's page shows: the model, the filaments it needs, the household's spools and how they match. */
export async function loadForModel({ models, shared, user }, modelId, fileId) {
  // As the signed-in user: what reaches one account isn't another's, should the page change hands.
  const who = user?.id ?? "?";
  const [model, spoolEntries, needEntries] = await Promise.all([
    readOnce(`${who}:model:${modelId}`, () => models.get(modelId)),
    readOnce(`${who}:spools`, () => readAll(shared, { prefix: SPOOL })),
    readOnce(`${who}:needs:${modelId}`, () => readAll(shared, { prefix: NEEDS, model: modelId })),
  ]);
  const file = pickFile(model, fileId);
  const profile = profileKey(file);
  const edit = currentEdit(needEntries, profile);
  const needs = needsFor(model, fileId, edit);
  const spools = spoolsOf(spoolEntries);
  const everyone = people([...spoolEntries, ...needEntries], user ?? null);
  return {
    model,
    file,
    profile,
    edit,
    needs,
    spools,
    everyone,
    match: matchAll(needs, spools, everyone),
  };
}

/** Words in a list: "A", "A and B", "A, B and C". */
export function listNames(names, and) {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
}

/**
 * Runs each write after the ones queued under the same key before it, whether they worked or not, so two quick
 * changes to one entry are stored in the order they were made rather than the order their requests finish.
 */
export function writesInTurn() {
  const tails = new Map();
  return (key, write) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(write);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
