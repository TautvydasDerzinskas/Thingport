// Reading a generator script's parameters: which control each one wants, and what to send back to the engine.
//
// Nothing here parses OpenSCAD. The parameter list comes from OpenSCAD itself through the SDK, which is the
// whole point: the groups, ranges, captions and choices are the ones the script's author wrote, read by the
// program that will run the script, not by a guess at its comment syntax. What it can't read unaided is the
// SDK's to deal with too, in sdk/scadScript.ts.
//
// The openscad-customizer tool carries its own copy of this logic. A tool is a sandboxed bundle of its own and
// can't import from the app, so the two are deliberately separate rather than shared.

import type { ScadParameter } from "../../sdk/openscad";

export const SCRIPT_EXTENSION = ".scad";

export type ParameterValues = Record<string, unknown>;

export type Choice = { name: string; value: unknown };

/** What kind of control a parameter wants, with whatever that control needs to draw itself. */
export type Control =
  /** `on` and `off` are which choice each way of the switch sets, never the order they were declared in. */
  | { kind: "switch"; on: Choice; off: Choice }
  | { kind: "segmented"; options: Choice[] }
  | { kind: "select"; options: Choice[] }
  | { kind: "slider"; min: number; max: number; step: number }
  | { kind: "number"; step: number }
  | { kind: "vector" }
  | { kind: "color" }
  | { kind: "font" }
  | { kind: "file"; accept: string }
  | { kind: "text" };

/**
 * A script as the engine should see it: Unix line endings.
 *
 * OpenSCAD reads a parameter's widget out of the comment after it, and a trailing CR makes it miss every one --
 * a script written on Windows opens with none of its dropdowns or sliders and nothing to say why. The backend
 * puts this right for the scripts it stores, so this is a belt to that brace.
 */
export function readyScript(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

const YES_NO = /^(yes|no|true|false|on|off)$/i;

/** Which of a two-way choice means "on", whichever order the script declared the pair in. */
const isOnChoice = (choice: Choice) => choice.value === true || /^(yes|true|on)$/i.test(String(choice.value));

const BOOLEAN_ON: Choice = { name: "true", value: true };
const BOOLEAN_OFF: Choice = { name: "false", value: false };

/** A step fine enough to reach the values in between, without a slider of ten thousand positions. */
function stepFor(min: number, max: number): number {
  const span = Math.abs(max - min);
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return 1;
}

/**
 * What kind of control a parameter wants.
 *
 * OpenSCAD types a parameter by the value it was declared with, and says separately whether the declaration
 * ended in a list of choices or a range. Those two decide the control: a handful of choices is a set of
 * buttons, a long list is a dropdown, a number with both ends is a slider, and everything else is a field.
 */
export function controlFor(parameter: ScadParameter): Control {
  if (parameter.widget === "color") return { kind: "color" };
  if (parameter.widget === "font") return { kind: "font" };
  if (parameter.widget === "file") return { kind: "file", accept: parameter.accept ?? "" };
  const options = parameter.options ?? [];
  if (options.length) {
    const yesNo = options.length === 2 && options.every((option) => YES_NO.test(String(option.value)));
    if (yesNo) {
      // By what each choice means, not by where it was declared: `// [No, Yes]` is as legal as `// [Yes, No]`,
      // and taking the first for "on" would set the opposite of whatever the switch was moved to.
      const on = options.find(isOnChoice) ?? options[0];
      return { kind: "switch", on, off: options.find((option) => option !== on) ?? options[1] };
    }
    return options.length <= 4 ? { kind: "segmented", options } : { kind: "select", options };
  }
  if (parameter.type === "boolean") return { kind: "switch", on: BOOLEAN_ON, off: BOOLEAN_OFF };
  if (parameter.type === "number") {
    const { min, max } = parameter;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { kind: "slider", min: min!, max: max!, step: parameter.step || stepFor(min!, max!) };
    }
    return { kind: "number", step: parameter.step || 1 };
  }
  if (parameter.type === "vector") return { kind: "vector" };
  return { kind: "text" };
}

export type ParameterGroup = { name: string; parameters: ScadParameter[] };

/** Parameters in the order the script declares them, grouped by their `/* [Heading] *\/`. */
export function groupParameters(parameters: ScadParameter[]): ParameterGroup[] {
  const groups: ParameterGroup[] = [];
  for (const parameter of parameters) {
    // OpenSCAD's own convention: a group named "Hidden" is the script's workings, not the reader's business.
    if (/^hidden$/i.test(parameter.group)) continue;
    let group = groups.find((candidate) => candidate.name === parameter.group);
    if (!group) {
      group = { name: parameter.group, parameters: [] };
      groups.push(group);
    }
    group.parameters.push(parameter);
  }
  return groups;
}

/** The values a script starts on, which are the ones its author chose. */
export function defaultValues(parameters: ScadParameter[]): ParameterValues {
  return Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.initial]));
}

/** Only what the reader actually moved, so the script's own defaults keep working if it is updated. */
export function changedValues(parameters: ScadParameter[], values: ParameterValues): ParameterValues {
  const changed: ParameterValues = {};
  for (const parameter of parameters) {
    const value = values[parameter.name];
    if (value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(parameter.initial)) continue;
    changed[parameter.name] = value;
  }
  return changed;
}

/** Whether anything has been moved off the script's own values, which is what Reset has to undo. */
export function hasChanges(parameters: ScadParameter[], values: ParameterValues): boolean {
  return Object.keys(changedValues(parameters, values)).length > 0;
}

/** A filename for the generated model: the script's name, and what was changed, where that is short enough. */
export function generatedName(scriptName: string, modelName: string | undefined, values: ParameterValues): string {
  const base = (modelName || scriptName.replace(/\.scad$/i, "")).trim() || "model";
  const text = Object.values(values).find(
    // A colour is a value, not a name: "Keyring - #ff0000" tells nobody anything, and a # is a nuisance in a filename.
    (value) => typeof value === "string" && /\S/.test(value) && value.length < 24 && !/^#[0-9a-f]{6}$/i.test(value),
  );
  return text ? `${base} - ${text}` : base;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, at) => byte === b[at]);

/** Where the stand-ins live. A chosen file under one of these would read as nothing chosen, and would replace the
 *  stand-in for any other parameter still on it. */
const STAND_IN_NAME = /^default\.(png|svg|stl)$/;

/**
 * The name a chosen file goes to the engine under: its own, unless a different file already has it.
 *
 * Choosing the same file again lands on the same name, so it isn't another step to undo; a different one of the
 * same name, or the same one edited since, gets a name of its own rather than swapping out what an earlier value
 * in the history pointed at.
 */
export function uploadName(uploads: ReadonlyMap<string, Uint8Array>, fileName: string, bytes: Uint8Array): string {
  const dot = fileName.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ""];
  for (let copy = 1; ; copy++) {
    const name = copy === 1 ? fileName : `${stem} (${copy})${extension}`;
    if (STAND_IN_NAME.test(name)) continue;
    const held = uploads.get(name);
    if (!held || sameBytes(held, bytes)) return name;
  }
}

/** Of the files chosen so far, the ones these values point at, as a render takes them. */
export function chosenFiles(
  uploads: ReadonlyMap<string, Uint8Array>,
  values: ParameterValues,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const value of Object.values(values)) {
    const bytes = typeof value === "string" ? uploads.get(value) : undefined;
    if (bytes) files[value as string] = bytes;
  }
  return files;
}

/** A warning the engine printed that the reader can do something about; the rest is progress chatter. */
export function readableWarnings(log: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of log) {
    if (!/^(WARNING|ERROR):/i.test(line)) continue;
    // Said once per use of the font, which for a nameplate is once per letter.
    const text = line.replace(/\s+in file .*$/, "").trim();
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
