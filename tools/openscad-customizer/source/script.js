// Reading a generator script: which of a model's files is one, and how its parameters become controls.
//
// Nothing here parses OpenSCAD. The parameter list comes from OpenSCAD itself through the SDK, which is the
// whole point: the groups, ranges, captions and choices are the ones the script's author wrote, read by the
// program that will run the script, not by a guess at its comment syntax.

export const SCRIPT_EXTENSION = ".scad";

/**
 * A script as the engine should see it: Unix line endings.
 *
 * OpenSCAD reads a parameter's widget out of the comment after it, and a trailing CR makes it miss every one --
 * a script written on Windows opens with none of its dropdowns or sliders and nothing to say why. Thingport
 * does this to the scripts it imports, but a file opened from a disk here hasn't been through that.
 */
export function readyScript(text) {
  return text.replace(/\r\n/g, "\n");
}

/** The files of a model that are generator scripts. */
export function scriptsAmong(relatedFiles) {
  return relatedFiles.filter((file) => file.name.toLowerCase().endsWith(SCRIPT_EXTENSION));
}

/**
 * What kind of control a parameter wants.
 *
 * OpenSCAD types a parameter by the value it was declared with, and says separately whether the declaration
 * ended in a list of choices or a range. Those two decide the control: a handful of choices is a set of
 * buttons, a long list is a dropdown, a number with both ends is a slider, and everything else is a field.
 */
export function controlFor(parameter) {
  if (parameter.widget === "color") return { kind: "color" };
  if (parameter.widget === "font") return { kind: "font" };
  if (parameter.widget === "file") return { kind: "file", accept: parameter.accept ?? "" };
  const options = parameter.options ?? [];
  if (options.length) {
    const yesNo = options.length === 2 && options.every((o) => /^(yes|no|true|false|on|off)$/i.test(String(o.value)));
    if (yesNo) {
      // By what each choice means, not by where it was declared: `// [No, Yes]` is as legal as `// [Yes, No]`,
      // and taking the first for "on" would set the opposite of whatever the switch was moved to.
      const on = options.find(isOnChoice) ?? options[0];
      return { kind: "switch", on, off: options.find((o) => o !== on) ?? options[1] };
    }
    return options.length <= 4 ? { kind: "segmented", options } : { kind: "select", options };
  }
  if (parameter.type === "boolean") return { kind: "switch", on: BOOLEAN_ON, off: BOOLEAN_OFF };
  if (parameter.type === "number") {
    const { min, max } = parameter;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { kind: "slider", min, max, step: parameter.step || stepFor(min, max) };
    }
    return { kind: "number", step: parameter.step || 1 };
  }
  if (parameter.type === "vector") return { kind: "vector" };
  return { kind: "text" };
}

/** Which of a two-way choice means "on", whichever order the script declared the pair in. */
const isOnChoice = (choice) => choice.value === true || /^(yes|true|on)$/i.test(String(choice.value));

const BOOLEAN_ON = { name: "true", value: true };
const BOOLEAN_OFF = { name: "false", value: false };

/** A step fine enough to reach the values in between, without a slider of ten thousand positions. */
function stepFor(min, max) {
  const span = Math.abs(max - min);
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return 1;
}

/** Parameters in the order the script declares them, grouped by their `/* [Heading] *\/`. */
export function groupParameters(parameters) {
  const groups = [];
  for (const parameter of parameters) {
    // OpenSCAD's own convention: a group named "Hidden" is the script's workings, not the reader's business.
    if (/^hidden$/i.test(parameter.group)) continue;
    let group = groups.find((g) => g.name === parameter.group);
    if (!group) {
      group = { name: parameter.group, parameters: [] };
      groups.push(group);
    }
    group.parameters.push(parameter);
  }
  return groups;
}

/** The values a script starts on, which are the ones its author chose. */
export function defaultValues(parameters) {
  return Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.initial]));
}

/** Only what the reader actually moved, so the script's own defaults keep working if it is updated. */
export function changedValues(parameters, values) {
  const changed = {};
  for (const parameter of parameters) {
    const value = values[parameter.name];
    if (value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(parameter.initial)) continue;
    changed[parameter.name] = value;
  }
  return changed;
}

/** A filename for the generated model: the script's name, and what was changed, where that is short enough. */
export function generatedName(scriptName, modelName, values) {
  const base = (modelName || scriptName.replace(/\.scad$/i, "")).trim() || "model";
  const text = Object.values(values).find(
    // A colour is a value, not a name: "Keyring - #ff0000" tells nobody anything, and a # is a nuisance in a filename.
    (value) => typeof value === "string" && /\S/.test(value) && value.length < 24 && !/^#[0-9a-f]{6}$/i.test(value),
  );
  return text ? `${base} - ${text}` : base;
}

const sameBytes = (a, b) => a.length === b.length && a.every((byte, at) => byte === b[at]);

/** Where the stand-ins live. A chosen file under one of these would read as nothing chosen, and would replace the
 *  stand-in for any other parameter still on it. */
const STAND_IN_NAME = /^default\.(png|svg|stl)$/;

/**
 * The name a chosen file goes to the engine under: its own, unless a different file already has it, so a second
 * file of the same name doesn't swap out what the first parameter pointed at.
 */
export function uploadName(uploads, fileName, bytes) {
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
export function chosenFiles(uploads, values) {
  const files = {};
  for (const value of Object.values(values)) {
    const bytes = typeof value === "string" ? uploads.get(value) : undefined;
    if (bytes) files[value] = bytes;
  }
  return files;
}

/** A warning the engine printed that the reader can do something about; the rest is progress chatter. */
export function readableWarnings(log) {
  const seen = new Set();
  const out = [];
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
