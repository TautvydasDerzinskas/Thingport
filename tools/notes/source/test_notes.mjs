// The tool's tests. Run from the tool's folder:
//   node source/test_notes.mjs
//
// What's stored is read back as the parts draw it: notes from before looks and colours still show, a value that isn't
// a note is left out, a picture gets only its own notes and the board only the user's. And the labels: every key the
// code asks for exists in English.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COLORS,
  LOOKS,
  NoteChanged,
  NoteGone,
  PREFIX,
  newNoteKey,
  noteValue,
  readNotes,
  readView,
  rebaseEdit,
  restoredTried,
  saveNote,
  storedNote,
} from "./notes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function fakeStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    keys: async () => [...data.keys()],
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

function fakeShared(entries = [], { readable, full, stuck } = {}) {
  const calls = [];
  return {
    calls,
    list: async (options) => (calls.push(options), entries),
    set: async (key, value, options) => {
      calls.push({ set: key, value, options });
      // As the server does for a model the writer can't open.
      if (readable && options?.model && !readable.includes(options.model)) throw new Error("No such model");
      if (full) throw new Error("This tool shares 5000 entries at most for you");
    },
    remove: async (key) => {
      calls.push({ remove: key });
      if (stuck) throw new Error("Couldn't remove it");
    },
  };
}

test("a note from before looks and colours shows as a yellow bubble", () => {
  assert.deepEqual(noteValue({ x: 0.2, y: 0.4, text: "Hi" }), {
    x: 0.2,
    y: 0.4,
    text: "Hi",
    look: "bubble",
    color: "yellow",
  });
});

test("a note keeps the look and colour it was saved with, and only known ones", () => {
  assert.equal(noteValue({ x: 0, y: 1, text: "a", look: "sticky", color: "pink" }).look, "sticky");
  assert.equal(noteValue({ x: 0, y: 1, text: "a", look: "sticky", color: "pink" }).color, "pink");
  assert.equal(noteValue({ x: 0, y: 1, text: "a", look: "cloud", color: "#f00" }).look, "bubble");
  assert.equal(noteValue({ x: 0, y: 1, text: "a", look: "cloud", color: "#f00" }).color, COLORS[0]);
  assert.deepEqual(LOOKS, ["bubble", "sticky"]);
});

test("a value that isn't a note is left out", () => {
  for (const value of [
    null,
    "text",
    { x: 0.5, y: 0.5, text: "" },
    { x: 0.5, y: 0.5, text: "x".repeat(501) },
    { x: 1.2, y: 0.5, text: "a" },
    { x: 0.5, y: Number.NaN, text: "a" },
    { x: "0.5", y: 0.5, text: "a" },
    { y: 0.5, text: "a" },
  ])
    assert.equal(noteValue(value), null, JSON.stringify(value));
});

test("a new note's key names its model and picture", () => {
  const key = newNoteKey("model-1", "image:abc");
  assert.match(key, /^note:model-1:image:abc:\d+-\d+-\d+-\d+$/);
  assert.notEqual(key, newNoteKey("model-1", "image:abc"));
});

test("a picture shows its own notes, everyone's that reach the viewer, newest first", async () => {
  const storage = fakeStorage({
    "note:m1:image:a:1": { x: 0.1, y: 0.1, text: "old mine", updatedAt: "2026-01-01T00:00:00Z" },
    "note:m1:image:b:2": { x: 0.1, y: 0.1, text: "other picture", updatedAt: "2026-03-01T00:00:00Z" },
    "note:m1:image:a:3": { x: 2, y: 0.1, text: "broken" },
    view: { hidden: true },
  });
  const shared = fakeShared([
    {
      key: "note:m9:image:x:4",
      value: { x: 0.5, y: 0.5, text: "theirs", look: "sticky", color: "blue" },
      user: { id: "u2", name: "Jonas" },
      mine: false,
      modelId: "m9",
      previewMatch: true,
      updatedAt: "2026-02-01T00:00:00Z",
    },
    {
      key: "note:m9:image:y:5",
      value: { x: 0.5, y: 0.5, text: "their other picture" },
      user: { id: "u2", name: "Jonas" },
      mine: false,
      modelId: "m9",
      previewMatch: false,
      updatedAt: "2026-02-02T00:00:00Z",
    },
  ]);
  const notes = await readNotes({ storage, shared }, { model: "m1", preview: "image:a" });
  assert.deepEqual(
    notes.map((note) => note.value.text),
    ["theirs", "old mine"],
  );
  assert.equal(notes[0].public, true);
  assert.equal(notes[0].value.look, "sticky");
  assert.equal(notes[1].value.look, "bubble");
  assert.deepEqual(shared.calls[0], { prefix: PREFIX, model: "m1", preview: "image:a", before: undefined });
});

test("the board shows only the user's own notes, on every model", async () => {
  const storage = fakeStorage({ "note:m1:image:a:1": { x: 0.1, y: 0.1, text: "mine", updatedAt: "2026-01-01" } });
  const shared = fakeShared([
    { key: "note:m2:image:a:2", value: { x: 0, y: 0, text: "my public" }, mine: true, updatedAt: "2026-02-01" },
    { key: "note:m3:image:a:3", value: { x: 0, y: 0, text: "theirs" }, mine: false, updatedAt: "2026-03-01" },
  ]);
  const notes = await readNotes({ storage, shared });
  assert.deepEqual(
    notes.map((note) => [note.value.text, note.modelId ?? null]),
    [
      ["my public", null],
      ["mine", "m1"],
    ],
  );
});

test("a note is kept where its visibility says, with its look and colour", async () => {
  const storage = fakeStorage();
  const shared = fakeShared();
  const value = { x: 0.3, y: 0.6, text: "Hello", look: "sticky", color: "green", extra: "dropped" };
  assert.deepEqual(
    (({ key, leftover }) => ({ key, leftover }))(
      await saveNote({ storage, shared }, { key: "note:m1:image:a:1", public: false }, value, "m1"),
    ),
    { key: "note:m1:image:a:1", leftover: false },
  );
  const kept = storage.data.get("note:m1:image:a:1");
  assert.deepEqual(
    { ...kept, updatedAt: undefined },
    { x: 0.3, y: 0.6, text: "Hello", look: "sticky", color: "green", updatedAt: undefined },
  );
  assert.ok(Date.parse(kept.updatedAt));
  await saveNote({ storage, shared }, { key: "note:m1:image:a:2", public: true }, value, "m1");
  assert.deepEqual(shared.calls.at(-1), {
    set: "note:m1:image:a:2",
    value: { x: 0.3, y: 0.6, text: "Hello", look: "sticky", color: "green" },
    options: { model: "m1" },
  });
});

const value = { x: 0.5, y: 0.5, text: "Hi", look: "bubble", color: "yellow" };
// The server's answer for a model's licence, which is how a note asks after a model: gone for the writer, or there.
const fakeApi = (gone) => async (path) => {
  assert.match(path, /^\/print\/[^/]+\/license$/);
  return { status: gone.some((id) => path === `/print/${id}/license`) ? 404 : 200 };
};

test("a public note edited on another copy stays tied to the model its key names", async () => {
  const shared = fakeShared([], { readable: ["m1", "m2"] });
  const note = { key: "note:m1:image:a:1", public: true, modelId: "m1" };
  const saved = await saveNote({ storage: fakeStorage(), shared, api: fakeApi([]) }, note, value, "m2", "note:m2:b:9");
  assert.deepEqual(saved, { key: note.key, value, leftover: false });
  assert.deepEqual(shared.calls, [{ set: note.key, value, options: { model: "m1" } }]);
});

test("a public note whose writer can't open its model any more moves to the copy it's edited on", async () => {
  const note = { key: "note:m1:image:a:1", public: true, modelId: "m1", existing: true, original: value };
  const shared = fakeShared([{ key: note.key, value, mine: true }], { readable: ["m2"] });
  const moveKey = "note:m2:image:b:9";
  const changed = { ...value, text: "Moved" };
  const saved = await saveNote({ storage: fakeStorage(), shared, api: fakeApi(["m1"]) }, note, changed, "m2", moveKey);
  assert.deepEqual(saved, { key: moveKey, value: changed, leftover: false });
  // Checked it's still there, tried where it was, wrote it here, then took the old one away.
  assert.deepEqual(shared.calls, [
    { prefix: note.key },
    { set: note.key, value: changed, options: { model: "m1" } },
    { set: moveKey, value: changed, options: { model: "m2" } },
    { remove: note.key },
  ]);
});

test("an edit writes only the fields it changed onto the note as stored now", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, text: "Original" };
  const storage = fakeStorage({ [key]: { ...original, text: "Revised elsewhere" } });
  const edited = { ...original, color: "blue" };
  const saved = await saveNote({ storage, shared: fakeShared() }, { key, existing: true, original }, edited, "m1");
  assert.deepEqual(saved.value, { ...original, text: "Revised elsewhere", color: "blue" });
  assert.equal(storage.data.get(key).text, "Revised elsewhere");
  assert.equal(storage.data.get(key).color, "blue");
});

test("a field already stored as the edit asks, as after a lost answer, isn't a conflict", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, color: "yellow" };
  const storage = fakeStorage({ [key]: { ...original, color: "blue" } });
  const edited = { ...original, color: "blue" };
  const saved = await saveNote({ storage, shared: fakeShared() }, { key, existing: true, original }, edited, "m1");
  assert.equal(saved.value.color, "blue");
  const pink = fakeStorage({ [key]: { ...original, color: "pink" } });
  await assert.rejects(
    saveNote({ storage: pink, shared: fakeShared() }, { key, existing: true, original }, edited, "m1"),
    NoteChanged,
  );
});

test("an edit of a field changed somewhere else too isn't saved over it, and says what the note is now", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, text: "Original" };
  const storage = fakeStorage({ [key]: { ...original, text: "Revised elsewhere" } });
  const edited = { ...original, text: "Mine" };
  await assert.rejects(
    saveNote({ storage, shared: fakeShared() }, { key, existing: true, original }, edited, "m1"),
    (error) => error instanceof NoteChanged && error.stored.text === "Revised elsewhere",
  );
  assert.equal(storage.data.get(key).text, "Revised elsewhere");
});

test("after a conflict, saving again keeps both changes: the edit's own and the other one's", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, text: "Original", color: "yellow" };
  const storage = fakeStorage({ [key]: { ...original, text: "Revised elsewhere", color: "pink" } });
  const thingport = { storage, shared: fakeShared() };
  const edited = { ...original, color: "blue" };
  const conflict = await saveNote(thingport, { key, existing: true, original }, edited, "m1").catch((error) => error);
  assert.ok(conflict instanceof NoteChanged);
  // What the editor shows next: its own colour, the text as it's stored.
  const rebased = rebaseEdit(edited, original, conflict.stored);
  assert.deepEqual(rebased, { ...original, text: "Revised elsewhere", color: "blue" });
  await saveNote(thingport, { key, existing: true, original: conflict.stored }, rebased, "m1");
  assert.equal(storage.data.get(key).text, "Revised elsewhere");
  assert.equal(storage.data.get(key).color, "blue");
});

test("a note missing from a picture is only taken for deleted once where it's kept says so", async () => {
  const key = "note:m9:image:x:4";
  const shared = fakeShared([{ key, value, mine: true }]);
  assert.deepEqual(await storedNote({ storage: fakeStorage(), shared }, { key, public: true }), value);
  assert.deepEqual(shared.calls, [{ prefix: key }]);
  const someoneElses = fakeShared([{ key, value, mine: false }]);
  assert.equal(await storedNote({ storage: fakeStorage(), shared: someoneElses }, { key, public: true }), null);
  assert.equal(await storedNote({ storage: fakeStorage(), shared: fakeShared() }, { key, public: false }), null);
  const failing = { ...fakeStorage(), get: async () => Promise.reject(new Error("offline")) };
  await assert.rejects(storedNote({ storage: failing, shared: fakeShared() }, { key, public: false }), /offline/);
});

test("a failed save on a model its writer can still open is reported, not moved", async () => {
  const shared = fakeShared([], { full: true });
  const note = { key: "note:m1:image:a:1", public: true, modelId: "m1" };
  const thingport = { storage: fakeStorage(), shared, api: fakeApi([]) };
  await assert.rejects(saveNote(thingport, note, value, "m2", "note:m2:image:b:9"), /5000 entries/);
  assert.equal(shared.calls.length, 1);
});

test("a public note that can't be saved on the model it's edited on isn't moved", async () => {
  const shared = fakeShared([], { readable: [] });
  const note = { key: "note:m1:image:a:1", public: true, modelId: "m1" };
  const thingport = { storage: fakeStorage(), shared, api: fakeApi(["m1"]) };
  await assert.rejects(saveNote(thingport, note, value, "m1", "note:m1:image:a:9"), /No such model/);
  assert.equal(shared.calls.length, 1);
});

test("a moved note whose old copy can't be removed says so, and is kept", async () => {
  const shared = fakeShared([], { readable: ["m2"], stuck: true });
  const note = { key: "note:m1:image:a:1", public: true, modelId: "m1" };
  const thingport = { storage: fakeStorage(), shared, api: fakeApi(["m1"]) };
  assert.deepEqual(await saveNote(thingport, note, value, "m2", "note:m2:image:b:9"), {
    key: "note:m2:image:b:9",
    value,
    leftover: true,
  });
});

test("a note that can't move for want of room fails as a whole, leaving the old copy alone", async () => {
  const shared = fakeShared([], { readable: ["m2"], full: true });
  const note = { key: "note:m1:image:a:1", public: true, modelId: "m1" };
  const thingport = { storage: fakeStorage(), shared, api: fakeApi(["m1"]) };
  await assert.rejects(saveNote(thingport, note, value, "m2", "note:m2:image:b:9"), /5000 entries/);
  assert.ok(!shared.calls.some((call) => call.remove));
});

test("an edit of a note deleted meanwhile isn't written back", async () => {
  const storage = fakeStorage();
  const personal = { key: "note:m1:image:a:1", public: false, existing: true };
  await assert.rejects(saveNote({ storage, shared: fakeShared() }, personal, value, "m1"), NoteGone);
  assert.equal(storage.data.size, 0);
  const shared = fakeShared([{ key: "note:m1:image:a:2", mine: true }]);
  const publicNote = { key: "note:m1:image:a:1", public: true, modelId: "m1", existing: true };
  await assert.rejects(saveNote({ storage, shared }, publicNote, value, "m1"), NoteGone);
  assert.ok(!shared.calls.some((call) => call.set));
});

test("an edit of a note still there is saved over it", async () => {
  const key = "note:m1:image:a:1";
  const storage = fakeStorage({ [key]: { ...value, text: "Old" } });
  const note = { key, public: false, existing: true, original: { ...value, text: "Old" } };
  const saved = await saveNote({ storage, shared: fakeShared() }, note, value, "m1");
  assert.deepEqual(saved, { key, value, leftover: false });
  assert.equal(storage.data.get(key).text, "Hi");
});

test("a new note's retry after a lost answer is an edit of what was sent, so a change made elsewhere since stays", async () => {
  const key = "note:m1:image:a:1";
  const sent = { ...value, text: "Sent" };
  // The first save went through, its answer lost, and the note was revised in another tab.
  const storage = fakeStorage({ [key]: { ...sent, text: "Revised elsewhere" } });
  const thingport = { storage, shared: fakeShared() };
  const note = { key, public: false, tried: [sent] };
  assert.equal((await saveNote(thingport, note, sent, "m1")).value.text, "Revised elsewhere");
  // A change only the retry makes goes onto it.
  await saveNote(thingport, note, { ...sent, color: "blue" }, "m1");
  assert.deepEqual([storage.data.get(key).text, storage.data.get(key).color], ["Revised elsewhere", "blue"]);
  // One the other tab made too isn't saved over; after the conflict the edit is one of the note as stored.
  const mine = { ...sent, text: "Mine" };
  const conflict = await saveNote(thingport, note, mine, "m1").catch((error) => error);
  assert.ok(conflict instanceof NoteChanged);
  assert.equal(storage.data.get(key).text, "Revised elsewhere");
  const rebased = rebaseEdit(mine, sent, conflict.stored);
  await saveNote(thingport, { key, public: false, existing: true, original: conflict.stored }, rebased, "m1");
  assert.deepEqual([storage.data.get(key).text, storage.data.get(key).color], ["Mine", "blue"]);
});

test("a new note's retry whose first save didn't go through is written afresh", async () => {
  const key = "note:m1:image:a:1";
  const sent = { ...value, text: "Sent" };
  const storage = fakeStorage();
  await saveNote(
    { storage, shared: fakeShared() },
    { key, public: false, tried: [sent] },
    { ...sent, text: "Retried" },
    "m1",
  );
  assert.equal(storage.data.get(key).text, "Retried");
  // Someone else's public note under the same key isn't the viewer's.
  const shared = fakeShared([{ key, value: { ...sent, text: "Theirs" }, mine: false }]);
  await saveNote({ storage, shared }, { key, public: true, tried: [sent] }, sent, "m1");
  assert.deepEqual(shared.calls, [{ prefix: key }, { set: key, value: sent, options: { model: "m1" } }]);
});

test("after several lost answers, a retry keeps the latest edit, even one back to how the note was", async () => {
  const key = "note:m1:image:a:1";
  const a = { ...value, text: "A" };
  const b = { ...value, text: "B" };
  // An edit of a note that was A: B went through with its answer lost, then the edit went back to A.
  const storage = fakeStorage({ [key]: b });
  const thingport = { storage, shared: fakeShared() };
  await saveNote(thingport, { key, public: false, existing: true, original: a, tried: [b] }, a, "m1");
  assert.equal(storage.data.get(key).text, "A");
  // A new note whose saves of A and then B both went through, both answers lost.
  storage.data.set(key, b);
  await saveNote(thingport, { key, public: false, tried: [a, b] }, a, "m1");
  assert.equal(storage.data.get(key).text, "A");
});

test("a retry keeps its own lost change and what another tab changed in a field the edit never did", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, text: "A", color: "yellow" };
  const b = { ...original, text: "B" };
  // B went through with its answer lost, then another tab made the note pink.
  const storage = fakeStorage({ [key]: { ...b, color: "pink" } });
  const note = { key, public: false, existing: true, original, tried: [b] };
  await saveNote({ storage, shared: fakeShared() }, note, b, "m1");
  assert.deepEqual([storage.data.get(key).text, storage.data.get(key).color], ["B", "pink"]);
});

test("a field an earlier save changed counts as the edit's, even once it's back as it was", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, text: "A" };
  const b = { ...original, text: "B" };
  // B didn't go through, the edit went back to A, and another tab wrote C meanwhile.
  const storage = fakeStorage({ [key]: { ...original, text: "C" } });
  const note = { key, public: false, existing: true, original, tried: [b] };
  const conflict = await saveNote({ storage, shared: fakeShared() }, note, original, "m1").catch((error) => error);
  assert.ok(conflict instanceof NoteChanged);
  assert.equal(storage.data.get(key).text, "C");
  assert.equal(rebaseEdit(original, original, conflict.stored, [b]).text, "A");
});

test("a retried move whose new copy was written, its answer lost, is finished there, keeping another tab's change", async () => {
  const from = "note:m1:image:a:1";
  const to = "note:m2:image:b:9";
  const original = { ...value, text: "Old", color: "yellow" };
  const edited = { ...original, text: "Moved" };
  // The new copy went through, then another tab made it pink; the old one is still there.
  const shared = fakeShared(
    [
      { key: from, value: original, mine: true },
      { key: to, value: { ...edited, color: "pink" }, mine: true },
    ],
    { readable: ["m2"] },
  );
  const note = { key: from, public: true, modelId: "m1", existing: true, original, tried: [edited] };
  const saved = await saveNote({ storage: fakeStorage(), shared, api: fakeApi(["m1"]) }, note, edited, "m2", to);
  assert.deepEqual(saved, { key: to, value: { ...edited, color: "pink" }, leftover: false });
  assert.deepEqual(shared.calls, [
    { prefix: to },
    { set: to, value: { ...edited, color: "pink" }, options: { model: "m2" } },
    // The old copy is read first, and goes as the editor left it.
    { prefix: from },
    { remove: from },
  ]);
});

test("a retried move leaves an old copy saved to since, or unreadable, and says so", async () => {
  const from = "note:m1:image:a:1";
  const to = "note:m2:image:b:9";
  const original = { ...value, text: "Old" };
  const edited = { ...original, text: "Moved" };
  const note = { key: from, public: true, modelId: "m1", existing: true, original, tried: [edited] };
  const api = fakeApi(["m1"]);
  // Saved to since the move, as once its model can be opened again.
  const changed = fakeShared([
    { key: from, value: { ...original, color: "pink" }, mine: true },
    { key: to, value: edited, mine: true },
  ]);
  assert.equal(
    (await saveNote({ storage: fakeStorage(), shared: changed, api }, note, edited, "m2", to)).leftover,
    true,
  );
  assert.ok(!changed.calls.some((call) => call.remove));
  const unreadable = fakeShared([{ key: to, value: edited, mine: true }]);
  const list = unreadable.list;
  unreadable.list = async (options) => (options.prefix === from ? Promise.reject(new Error("offline")) : list(options));
  assert.equal(
    (await saveNote({ storage: fakeStorage(), shared: unreadable, api }, note, edited, "m2", to)).leftover,
    true,
  );
  assert.ok(!unreadable.calls.some((call) => call.remove));
  // Already gone: nothing is left.
  const gone = fakeShared([{ key: to, value: edited, mine: true }]);
  assert.equal((await saveNote({ storage: fakeStorage(), shared: gone, api }, note, edited, "m2", to)).leftover, false);
});

test("a retried move that meets a change to its new copy says so from there, and the old copy goes", async () => {
  const from = "note:m1:image:a:1";
  const to = "note:m2:image:b:9";
  const original = { ...value, color: "yellow" };
  const shared = fakeShared(
    [
      { key: from, value: original, mine: true },
      { key: to, value: { ...original, color: "pink" }, mine: true },
    ],
    { readable: ["m2"] },
  );
  const note = { key: from, public: true, modelId: "m1", existing: true, original, tried: [original] };
  const blue = { ...original, color: "blue" };
  const thingport = { storage: fakeStorage(), shared, api: fakeApi(["m1"]) };
  const conflict = await saveNote(thingport, note, blue, "m2", to).catch((error) => error);
  assert.ok(conflict instanceof NoteChanged);
  assert.equal(conflict.key, to);
  assert.equal(conflict.stored.color, "pink");
  assert.equal(conflict.leftover, false);
  assert.ok(!shared.calls.some((call) => call.set));
  assert.ok(shared.calls.some((call) => call.remove === from));
  // An old copy that can't be removed is reported with the conflict.
  const stuck = fakeShared(
    [
      { key: from, value: original, mine: true },
      { key: to, value: { ...original, color: "pink" }, mine: true },
    ],
    { stuck: true },
  );
  const stuckConflict = await saveNote({ ...thingport, shared: stuck }, note, blue, "m2", to).catch((error) => error);
  assert.ok(stuckConflict instanceof NoteChanged);
  assert.equal(stuckConflict.leftover, true);
});

test("a draft coming back onto a note changed since keeps its earlier saves to the fields it changed", async () => {
  const key = "note:m1:image:a:1";
  // A yellow note that was A: B saved with its answer lost, then the edit went back to A and the picture changed.
  const base = { ...value, text: "A", color: "yellow" };
  const tried = [{ ...base, text: "B" }];
  const changes = { text: "A" };
  // Meanwhile another tab made it pink, and the draft comes back onto that.
  const latest = { ...base, text: "B", color: "pink" };
  const restored = restoredTried(tried, latest, Object.keys(changes));
  assert.deepEqual(restored, [{ ...latest, text: "B" }]);
  // Then the other tab puts yellow back before the restored edit is saved: its yellow isn't taken for the edit's.
  const storage = fakeStorage({ [key]: { ...base, text: "B" } });
  const note = { key, public: false, existing: true, original: latest, tried: restored };
  await saveNote({ storage, shared: fakeShared() }, note, { ...latest, ...changes }, "m1");
  assert.deepEqual([storage.data.get(key).text, storage.data.get(key).color], ["A", "yellow"]);
});

test("a retried move whose new copy wasn't written moves as before", async () => {
  const from = "note:m1:image:a:1";
  const to = "note:m2:image:b:9";
  const original = { ...value, text: "Old" };
  const edited = { ...original, text: "Moved" };
  const shared = fakeShared([{ key: from, value: original, mine: true }], { readable: ["m2"] });
  const note = { key: from, public: true, modelId: "m1", existing: true, original, tried: [edited] };
  const saved = await saveNote({ storage: fakeStorage(), shared, api: fakeApi(["m1"]) }, note, edited, "m2", to);
  assert.deepEqual(saved, { key: to, value: edited, leftover: false });
  assert.deepEqual(shared.calls, [
    { prefix: to },
    { prefix: from },
    { set: from, value: edited, options: { model: "m1" } },
    { set: to, value: edited, options: { model: "m2" } },
    { remove: from },
  ]);
});

test("a save counts as sent only once it writes: not when its read fails, nor on a conflict", async () => {
  const key = "note:m1:image:a:1";
  const original = { ...value, text: "A" };
  let sends = 0;
  const onSend = () => sends++;
  const note = { key, public: false, existing: true, original, onSend };
  const failing = { ...fakeStorage({ [key]: original }), get: async () => Promise.reject(new Error("offline")) };
  await assert.rejects(saveNote({ storage: failing, shared: fakeShared() }, note, { ...original, text: "B" }, "m1"));
  assert.equal(sends, 0);
  const changed = fakeStorage({ [key]: { ...original, text: "C" } });
  await assert.rejects(saveNote({ storage: changed, shared: fakeShared() }, note, { ...original, text: "B" }, "m1"));
  assert.equal(sends, 0);
  await saveNote(
    { storage: fakeStorage({ [key]: original }), shared: fakeShared() },
    note,
    { ...original, text: "B" },
    "m1",
  );
  assert.equal(sends, 1);
});

test("the view starts with notes shown and a yellow sticky, and keeps what was saved", async () => {
  assert.deepEqual(await readView(fakeStorage()), { hidden: false, look: "sticky", color: "yellow" });
  assert.deepEqual(await readView(fakeStorage({ view: { hidden: true, look: "bubble", color: "blue" } })), {
    hidden: true,
    look: "bubble",
    color: "blue",
  });
  assert.deepEqual(await readView(fakeStorage({ view: { hidden: "yes", look: "x", color: "x" } })), {
    hidden: false,
    look: "sticky",
    color: "yellow",
  });
});

test("a failed read of the view throws, rather than passing for a viewer who saved none", async () => {
  const storage = { ...fakeStorage(), get: async () => Promise.reject(new Error("offline")) };
  await assert.rejects(readView(storage), /offline/);
});

test("every label the code asks for exists in English", () => {
  const english = JSON.parse(fs.readFileSync(path.join(here, "..", "locales", "en.json"), "utf8"));
  const code = ["notes.js", "ui.js", "preview.js", "board.js"]
    .map((file) => fs.readFileSync(path.join(here, file), "utf8"))
    .join("\n");
  const html = fs.readFileSync(path.join(here, "..", "tool.html"), "utf8");
  // Every label key written inside a t(…) call, both sides of a choice between two included; keys put together in the
  // code are listed by hand.
  const inCalls = [];
  for (let at = code.indexOf("t("); at !== -1; at = code.indexOf("t(", at + 2)) {
    if (/[\w.$]/.test(code[at - 1] ?? "")) continue;
    let depth = 0;
    let end = at + 1;
    for (; end < code.length; end++) {
      if (code[end] === "(") depth++;
      else if (code[end] === ")" && --depth === 0) break;
    }
    for (const match of code.slice(at, end).matchAll(/"([a-z]+(?:\.[A-Za-z]+)+)"/g)) inCalls.push(match[1]);
  }
  const asked = new Set([
    ...inCalls,
    ...[...html.matchAll(/data-t(?:-aria|-placeholder)?="([\w.]+)"/g)].map((match) => match[1]),
    ...COLORS.map((color) => "color." + color),
    ...["loading", "error", "empty", "noMatches"].map((kind) => "board." + kind),
  ]);
  const missing = [...asked].filter((key) => !(key in english));
  assert.deepEqual(missing, []);
  const unused = Object.keys(english).filter((key) => !asked.has(key));
  assert.deepEqual(unused, []);
});

test("every language the metadata lists has every English label, with the same placeholders", () => {
  const read = (code) => JSON.parse(fs.readFileSync(path.join(here, "..", "locales", code + ".json"), "utf8"));
  const english = read("en");
  const { locales } = JSON.parse(fs.readFileSync(path.join(here, "tool.base.json"), "utf8"));
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(
    fs.readdirSync(path.join(here, "..", "locales")).sort(),
    locales.map((code) => code + ".json").sort(),
  );
  for (const code of locales) {
    const labels = read(code);
    assert.deepEqual(Object.keys(labels).sort(), Object.keys(english).sort(), code);
    for (const [key, text] of Object.entries(english)) {
      assert.ok(labels[key].trim(), `${code} ${key} is empty`);
      assert.deepEqual(placeholders(labels[key]), placeholders(text), `${code} ${key}`);
    }
  }
});
