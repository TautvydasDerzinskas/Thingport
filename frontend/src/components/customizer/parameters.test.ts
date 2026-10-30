import { describe, expect, it } from "vitest";
import type { ScadParameter } from "../../sdk/openscad";
import {
  changedValues,
  controlFor,
  defaultValues,
  generatedName,
  groupParameters,
  hasChanges,
  readableWarnings,
  readyScript,
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
