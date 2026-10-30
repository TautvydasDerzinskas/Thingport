import { describe, expect, it } from "vitest";
import type { ScadParameter } from "../../sdk/openscad";
import {
  changedValues,
  chosenFiles,
  controlFor,
  defaultValues,
  generatedName,
  groupParameters,
  hasChanges,
  readableWarnings,
  readyScript,
  uploadName,
} from "./parameters";

const parameter = (over: Partial<ScadParameter>): ScadParameter => ({
  name: "p",
  group: "Parameters",
  type: "number",
  initial: 0,
  ...over,
});

describe("controlFor", () => {
  it("offers a few choices as buttons and many as a dropdown", () => {
    const choices = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `c${i}`, value: `c${i}` }));
    expect(controlFor(parameter({ type: "string", options: choices(3) })).kind).toBe("segmented");
    expect(controlFor(parameter({ type: "string", options: choices(4) })).kind).toBe("segmented");
    expect(controlFor(parameter({ type: "string", options: choices(5) })).kind).toBe("select");
  });

  it("reads a two-way choice that reads as yes/no as a switch", () => {
    const options = [
      { name: "yes", value: "yes" },
      { name: "no", value: "no" },
    ];
    expect(controlFor(parameter({ type: "string", options })).kind).toBe("switch");
  });

  it("points the switch at what each choice means, not at the order it was declared", () => {
    // A script is as free to write `// [No, Yes]` as `// [Yes, No]`; taking the first for "on" would set the
    // opposite of whatever the switch was moved to.
    const pair = (first: string, second: string) => [
      { name: first, value: first },
      { name: second, value: second },
    ];
    for (const [on, off] of [
      ["Yes", "No"],
      ["No", "Yes"],
      ["true", "false"],
      ["false", "true"],
      ["on", "off"],
      ["off", "on"],
    ].map(([a, b]) => (/^(yes|true|on)$/i.test(a) ? [a, b] : [b, a]))) {
      const control = controlFor(parameter({ type: "string", options: pair(on, off) }));
      expect(control).toMatchObject({ kind: "switch", on: { value: on }, off: { value: off } });
      const reversed = controlFor(parameter({ type: "string", options: pair(off, on) }));
      expect(reversed).toMatchObject({ kind: "switch", on: { value: on }, off: { value: off } });
    }
  });

  it("gives a declared boolean a true/false switch", () => {
    expect(controlFor(parameter({ type: "boolean", initial: true }))).toMatchObject({
      kind: "switch",
      on: { value: true },
      off: { value: false },
    });
  });

  it("gives a number a slider only when it has both ends", () => {
    expect(controlFor(parameter({ min: 0, max: 10 }))).toMatchObject({ kind: "slider", min: 0, max: 10 });
    expect(controlFor(parameter({ min: 0 })).kind).toBe("number");
    expect(controlFor(parameter({ max: 10 })).kind).toBe("number");
    expect(controlFor(parameter({})).kind).toBe("number");
  });

  it("keeps the author's step, and picks one fine enough for the span otherwise", () => {
    expect(controlFor(parameter({ min: 0, max: 10, step: 2 }))).toMatchObject({ step: 2 });
    expect(controlFor(parameter({ min: 0, max: 1 }))).toMatchObject({ step: 0.01 });
    expect(controlFor(parameter({ min: 0, max: 10 }))).toMatchObject({ step: 0.1 });
    expect(controlFor(parameter({ min: 0, max: 200 }))).toMatchObject({ step: 1 });
  });

  it("falls back on the declared type", () => {
    expect(controlFor(parameter({ type: "boolean", initial: true })).kind).toBe("switch");
    expect(controlFor(parameter({ type: "vector", initial: [1, 2, 3] })).kind).toBe("vector");
    expect(controlFor(parameter({ type: "string", initial: "x" })).kind).toBe("text");
  });

  it("gives a widget the control it names", () => {
    expect(controlFor(parameter({ type: "string", widget: "color" }))).toEqual({ kind: "color" });
    expect(controlFor(parameter({ type: "string", widget: "font" }))).toEqual({ kind: "font" });
    expect(controlFor(parameter({ type: "string", widget: "file", accept: ".png" }))).toEqual({
      kind: "file",
      accept: ".png",
    });
  });
});

describe("groupParameters", () => {
  it("keeps the script's own order and leaves Hidden out", () => {
    const groups = groupParameters([
      parameter({ name: "a", group: "Size" }),
      parameter({ name: "b", group: "Text" }),
      parameter({ name: "c", group: "Size" }),
      parameter({ name: "d", group: "Hidden" }),
      parameter({ name: "e", group: "hidden" }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["Size", "Text"]);
    expect(groups[0].parameters.map((p) => p.name)).toEqual(["a", "c"]);
  });
});

describe("changedValues", () => {
  const parameters = [
    parameter({ name: "size", initial: 10 }),
    parameter({ name: "label", type: "string", initial: "a" }),
    parameter({ name: "at", type: "vector", initial: [0, 0, 0] }),
  ];

  it("sends only what moved off the script's own values", () => {
    const values = { size: 12, label: "a", at: [0, 0, 0] };
    expect(changedValues(parameters, values)).toEqual({ size: 12 });
    expect(hasChanges(parameters, values)).toBe(true);
  });

  it("counts a vector as unchanged when its contents match", () => {
    const values = { size: 10, label: "a", at: [0, 0, 0] };
    expect(changedValues(parameters, values)).toEqual({});
    expect(hasChanges(parameters, values)).toBe(false);
  });

  it("leaves out a parameter with no value at all", () => {
    expect(changedValues(parameters, {})).toEqual({});
  });
});

describe("defaultValues", () => {
  it("is the values the author chose", () => {
    expect(defaultValues([parameter({ name: "size", initial: 10 })])).toEqual({ size: 10 });
  });
});

describe("generatedName", () => {
  it("names it after the model, and after the script where there is no model", () => {
    expect(generatedName("keychain.scad", "Keyring", {})).toBe("Keyring");
    expect(generatedName("keychain.scad", undefined, {})).toBe("keychain");
  });

  it("adds a short piece of text that was changed, which is usually what tells two apart", () => {
    expect(generatedName("keychain.scad", "Keyring", { TEXT: "Ada" })).toBe("Keyring - Ada");
    // Too long to be a name, and numbers aren't names at all.
    expect(generatedName("keychain.scad", "Keyring", { TEXT: "x".repeat(40) })).toBe("Keyring");
    expect(generatedName("keychain.scad", "Keyring", { size: 12 })).toBe("Keyring");
  });

  it("doesn't take a colour for a name, but will take the text beside one", () => {
    expect(generatedName("keychain.scad", "Keyring", { tint: "#ff0000" })).toBe("Keyring");
    expect(generatedName("keychain.scad", "Keyring", { tint: "#FF0000", TEXT: "Ada" })).toBe("Keyring - Ada");
  });
});

describe("uploadName", () => {
  const one = Uint8Array.from([1, 2, 3]);
  const other = Uint8Array.from([1, 2, 4]);

  it("keeps a file's own name while nothing else has it", () => {
    expect(uploadName(new Map(), "logo.png", one)).toBe("logo.png");
  });

  it("lands on the same name for the same file, so choosing it again isn't another step to undo", () => {
    expect(uploadName(new Map([["logo.png", one]]), "logo.png", Uint8Array.from([1, 2, 3]))).toBe("logo.png");
  });

  it("gives a different file of the same name one of its own", () => {
    const uploads = new Map([["logo.png", one]]);
    expect(uploadName(uploads, "logo.png", other)).toBe("logo (2).png");
    uploads.set("logo (2).png", other);
    expect(uploadName(uploads, "logo.png", Uint8Array.from([9]))).toBe("logo (3).png");
    expect(uploadName(new Map([["logo", one]]), "logo", other)).toBe("logo (2)");
  });

  it("never takes a stand-in's name, which would read as nothing chosen", () => {
    const uploads = new Map<string, Uint8Array>();
    expect(uploadName(uploads, "default.svg", one)).toBe("default (2).svg");
    expect(uploadName(uploads, "default.stl", one)).toBe("default (2).stl");

    const name = uploadName(uploads, "default.png", one);
    expect(name).toBe("default (2).png");
    // The whole way through: the value still counts as a change, so the file still reaches the engine.
    const changed = changedValues([parameter({ name: "image", type: "string", initial: "default.png" })], {
      image: name,
    });
    expect(chosenFiles(new Map([[name, one]]), changed)).toEqual({ [name]: one });
  });
});

describe("chosenFiles", () => {
  it("hands over only the files these values point at", () => {
    const logo = Uint8Array.from([1]);
    const uploads = new Map([
      ["logo.png", logo],
      ["old.png", Uint8Array.from([2])],
    ]);
    expect(chosenFiles(uploads, { image: "logo.png", label: "Ada", size: 3 })).toEqual({ "logo.png": logo });
    expect(chosenFiles(uploads, {})).toEqual({});
  });
});

describe("readableWarnings", () => {
  it("keeps the engine's warnings and errors, once each, and drops its chatter", () => {
    expect(
      readableWarnings([
        "Compiling design (CSG Tree generation)...",
        "WARNING: Can't find font Foo in file /model.scad, line 3",
        "WARNING: Can't find font Foo in file /model.scad, line 4",
        "ERROR: Parser error: syntax error in file /model.scad, line 9",
        "Geometries in cache: 12",
      ]),
    ).toEqual(["WARNING: Can't find font Foo", "ERROR: Parser error: syntax error"]);
  });
});

describe("readyScript", () => {
  it("drops the carriage returns that would hide every parameter's widget", () => {
    expect(readyScript("a = 1; // [1:10]\r\nb = 2;\r\n")).toBe("a = 1; // [1:10]\nb = 2;\n");
  });
});
