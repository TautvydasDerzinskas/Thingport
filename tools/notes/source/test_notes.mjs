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
  saveNote,
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
