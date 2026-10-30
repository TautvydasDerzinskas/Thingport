// Checks the customizer reads a script's parameters into the right controls, and sends back only what changed.
// Run with: node source/test_script.mjs
import assert from "node:assert/strict";
import {
  changedValues,
  chosenFiles,
  controlFor,
  defaultValues,
  generatedName,
  groupParameters,
  readableWarnings,
  scriptsAmong,
  uploadName,
} from "./script.js";

// The parameters below are shaped as OpenSCAD's own `--export-format param` writes them, which is where the
// tool gets them: that is the contract worth pinning, since nothing here parses the script itself.

function test(name, run) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

test("finds the scripts among a model's related files", () => {
  const files = [
    { id: "1", name: "keychain_customizable.scad" },
    { id: "2", name: "notes.txt" },
    { id: "3", name: "Generator V2.SCAD" },
  ];
  assert.deepEqual(
    scriptsAmong(files).map((f) => f.id),
    ["1", "3"],
  );
});

test("a short list of choices becomes buttons, a long one a dropdown", () => {
  const few = {
    name: "c",
    type: "string",
    initial: "a",
    options: [
      { name: "a", value: "a" },
      { name: "b", value: "b" },
      { name: "c", value: "c" },
    ],
  };
  const many = {
    name: "f",
    type: "string",
    initial: "x",
    options: Array.from({ length: 9 }, (_, i) => ({ name: `o${i}`, value: `o${i}` })),
  };

  assert.equal(controlFor(few).kind, "segmented");
  assert.equal(controlFor(many).kind, "select");
});

test("a yes/no pair becomes a switch rather than two buttons", () => {
  const yesNo = {
    name: "lid",
    type: "string",
    initial: "No",
    options: [
      { name: "Yes", value: "Yes" },
      { name: "No", value: "No" },
    ],
  };
  assert.equal(controlFor(yesNo).kind, "switch");
});

test("the switch points at what each choice means, not at the order it was declared", () => {
  // A script is as free to write `// [No, Yes]` as `// [Yes, No]`; taking the first for "on" would set the
  // opposite of whatever the switch was moved to.
  const lid = (options) => ({ name: "lid", type: "string", initial: options[0].value, options });
  const yes = { name: "Yes", value: "Yes" };
  const no = { name: "No", value: "No" };

  for (const options of [
    [yes, no],
    [no, yes],
  ]) {
    const control = controlFor(lid(options));
    assert.equal(control.on.value, "Yes");
    assert.equal(control.off.value, "No");
  }

  const declared = controlFor({ name: "lid", type: "boolean", initial: true });
  assert.equal(declared.on.value, true);
  assert.equal(declared.off.value, false);
});

test("a number with both ends becomes a slider, one without stays a field", () => {
  assert.equal(controlFor({ name: "w", type: "number", initial: 10, min: 1, max: 50 }).kind, "slider");
  assert.equal(controlFor({ name: "w", type: "number", initial: 10 }).kind, "number");
});

test("a slider gets a step fine enough to reach the values in between", () => {
  assert.equal(controlFor({ name: "t", type: "number", initial: 1, min: 0, max: 1 }).step, 0.01);
  assert.equal(controlFor({ name: "w", type: "number", initial: 10, min: 0, max: 200 }).step, 1);
  // The script's own step wins over the guess.
  assert.equal(controlFor({ name: "w", type: "number", initial: 10, min: 0, max: 200, step: 5 }).step, 5);
});

test("groups keep the script's order, and Hidden is left out", () => {
  const parameters = [
    { name: "a", group: "Text", type: "string", initial: "x" },
    { name: "b", group: "Base", type: "number", initial: 1 },
    { name: "c", group: "Text", type: "number", initial: 2 },
    { name: "d", group: "Hidden", type: "number", initial: 3 },
  ];
  const groups = groupParameters(parameters);
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Text", "Base"],
  );
  assert.deepEqual(
    groups[0].parameters.map((p) => p.name),
    ["a", "c"],
  );
});

test("sends back only what the reader changed", () => {
  const parameters = [
    { name: "TEXT", group: "T", type: "string", initial: "RMmaker" },
    { name: "width", group: "B", type: "number", initial: 80 },
  ];
  const values = defaultValues(parameters);
  assert.deepEqual(changedValues(parameters, values), {});

  values.TEXT = "Thingport";
  assert.deepEqual(changedValues(parameters, values), { TEXT: "Thingport" });
});

test("names the file after the model, and after the text where there is some", () => {
  assert.equal(generatedName("keychain.scad", "Keychain Creator", {}), "Keychain Creator");
  assert.equal(
    generatedName("keychain.scad", "Keychain Creator", { TEXT: "Thingport" }),
    "Keychain Creator - Thingport",
  );
  assert.equal(generatedName("keychain.scad", null, {}), "keychain");
  // A paragraph in a text parameter would make an unusable filename.
  assert.equal(generatedName("a.scad", "Model", { note: "x".repeat(40) }), "Model");
});

test("gives a widget the control it names", () => {
  assert.deepEqual(controlFor({ name: "c", type: "string", widget: "color" }), { kind: "color" });
  assert.deepEqual(controlFor({ name: "f", type: "string", widget: "font" }), { kind: "font" });
  assert.deepEqual(controlFor({ name: "i", type: "string", widget: "file", accept: ".png" }), {
    kind: "file",
    accept: ".png",
  });
  assert.equal(controlFor({ name: "v", type: "vector", initial: [1, 2, 3] }).kind, "vector");
});

test("doesn't take a colour for a name", () => {
  assert.equal(generatedName("a.scad", "Model", { tint: "#ff0000" }), "Model");
  assert.equal(generatedName("a.scad", "Model", { tint: "#FF0000", TEXT: "Ada" }), "Model - Ada");
});

test("a different file of the same name gets a name of its own, and the same file doesn't", () => {
  const one = Uint8Array.from([1, 2, 3]);
  const uploads = new Map([["logo.png", one]]);
  assert.equal(uploadName(new Map(), "logo.png", one), "logo.png");
  assert.equal(uploadName(uploads, "logo.png", Uint8Array.from([1, 2, 3])), "logo.png");
  assert.equal(uploadName(uploads, "logo.png", Uint8Array.from([1, 2, 4])), "logo (2).png");
});

test("hands over only the files the values point at", () => {
  const logo = Uint8Array.from([1]);
  const uploads = new Map([
    ["logo.png", logo],
    ["old.png", Uint8Array.from([2])],
  ]);
  assert.deepEqual(chosenFiles(uploads, { image: "logo.png", label: "Ada", size: 3 }), { "logo.png": logo });
});

test("keeps the warnings a reader can act on, once each", () => {
  const log = [
    "Geometries in cache: 18",
    "WARNING: Can't get font Shrikhand in file /model.scad, line 57",
    "WARNING: Can't get font Shrikhand in file /model.scad, line 61",
    "Total rendering time: 0:00:03.184",
    "ERROR: Parser error: syntax error in file /model.scad, line 3",
  ];
  assert.deepEqual(readableWarnings(log), ["WARNING: Can't get font Shrikhand", "ERROR: Parser error: syntax error"]);
});

if (!process.exitCode) console.log("\nall good");
