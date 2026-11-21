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

import { COLORS, LOOKS, PREFIX, newNoteKey, noteValue, readNotes, readView, saveNote } from "./notes.js";

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

function fakeShared(entries = []) {
  const calls = [];
  return {
    calls,
    list: async (options) => (calls.push(options), entries),
    set: async (key, value, options) => void calls.push({ set: key, value, options }),
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
  await saveNote({ storage, shared }, { key: "note:m1:image:a:1", public: false }, value, "m1");
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

test("every label the code asks for exists in English", () => {
  const english = JSON.parse(fs.readFileSync(path.join(here, "..", "locales", "en.json"), "utf8"));
  const code = ["notes.js", "ui.js", "preview.js", "board.js"]
    .map((file) => fs.readFileSync(path.join(here, file), "utf8"))
    .join("\n");
  const html = fs.readFileSync(path.join(here, "..", "tool.html"), "utf8");
  const asked = new Set([
    ...[...code.matchAll(/\bt\("([\w.]+)"(?!\s*\+)/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-t(?:-aria|-placeholder)?="([\w.]+)"/g)].map((match) => match[1]),
    // Put together in the code.
    ...COLORS.map((color) => "color." + color),
    ...["loading", "error", "empty", "noMatches"].map((kind) => "board." + kind),
  ]);
  const missing = [...asked].filter((key) => !(key in english));
  assert.deepEqual(missing, []);
  // Some are picked between in the code, so a key counts as used wherever it's written out.
  const unused = Object.keys(english).filter((key) => !asked.has(key) && !(code + html).includes(`"${key}"`));
  assert.deepEqual(unused, []);
});
