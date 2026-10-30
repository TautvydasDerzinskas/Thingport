// What OpenSCAD's customizer can't read of a script on its own.
//
// It reads parameters only above the script's first `{`, takes any one-line block comment for a heading, and has no
// word for a colour, a typeface or a file. MakerWorld's customizer, which most scripts here were written against, has
// a parser of its own with none of those limits: it offers every top-level constant in the file, so a script can keep
// them below a library pasted in first and still have its sliders there. Read by OpenSCAD alone, the same script has
// "nothing to change".
//
// The reading stays OpenSCAD's. A parameter set is ignored for anything its customizer didn't read, so controls drawn
// some other way would do nothing: the engine has to see the parameters itself. So the script it is given has them
// moved up to where it looks and its notes taken out of the way, neither of which changes what the script makes.

import { writeStl } from "./stl";
import type { ScadParameter } from "./types";

/** What OpenSCAD calls the group of a parameter under no heading. */
export const DEFAULT_GROUP = "Parameters";

type Heading = { line: number; name: string };

type Scan = {
  lines: string[];
  /** Whether each line starts in plain code at the top level, outside any comment, string or bracket. */
  topLevel: boolean[];
  /** How many times each name is assigned at the top level. */
  assigned: Map<string, number>;
  headings: Heading[];
  /** The one-line block comments that aren't headings, which the engine would take for empty ones. */
  notes: { line: number; start: number; end: number }[];
  /** Where the engine stops reading parameters, and the line the statement holding it starts on. */
  firstBrace: { line: number; statement: number } | null;
};

function scan(source: string): Scan {
  // A trailing CR hides a line's comment, from the engine as much as from anything here.
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const result: Scan = { lines, topLevel: [], assigned: new Map(), headings: [], notes: [], firstBrace: null };
  let depth = 0;
  let inBlockComment = false;
  let inString = false;
  let statement: number | null = null;

  const readLine = (text: string, line: number) => {
    const sawBrace = () => {
      result.firstBrace ??= { line, statement: statement ?? line };
    };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (inBlockComment) {
        const end = text.indexOf("*/", i);
        if (end < 0) return;
        inBlockComment = false;
        i = end + 1;
      } else if (inString) {
        if (char === "\\") i++;
        else if (char === '"') inString = false;
        // The engine counts a brace in a string too, so this has to.
        else if (char === "{") sawBrace();
      } else if (char === "/" && text[i + 1] === "/") {
        return;
      } else if (char === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) {
          inBlockComment = true;
          return;
        }
        const heading = /^\s*\[(.*?)\]/.exec(text.slice(i + 2, end));
        if (!heading) result.notes.push({ line, start: i, end: end + 2 });
        else if (depth === 0) result.headings.push({ line, name: heading[1].trim() });
        i = end + 1;
      } else if (!/\s/.test(char)) {
        if (depth === 0) statement ??= line;
        if (char === '"') {
          inString = true;
        } else if (depth === 0 && /[A-Za-z_]/.test(char) && !/[\w$]/.test(text[i - 1] ?? "")) {
          const name = /^\w+/.exec(text.slice(i))?.[0] ?? char;
          const rest = text.slice(i + name.length);
          if (/^\s*=(?!=)/.test(rest)) result.assigned.set(name, (result.assigned.get(name) ?? 0) + 1);
          // `include <a/b.scad>` ends with its line, with no semicolon to say so.
          if ((name === "include" || name === "use") && /^\s*</.test(rest)) {
            statement = null;
            return;
          }
          i += name.length - 1;
        } else if (char === "{" || char === "(" || char === "[") {
          if (char === "{") sawBrace();
          depth++;
        } else if (char === "}" || char === ")" || char === "]") {
          depth--;
          if (char === "}" && depth === 0) statement = null;
        } else if (char === ";" && depth === 0) {
          statement = null;
        }
      }
    }
  };

  lines.forEach((text, line) => {
    result.topLevel[line] = depth === 0 && !inBlockComment && !inString;
    readLine(text, line);
  });
  return result;
}

/** The script's lines with its notes blanked: comments are whitespace to the parser, and this keeps every column. */
function withoutNotes({ lines, notes }: Scan): string[] {
  const out = [...lines];
  for (const { line, start, end } of notes) {
    out[line] = out[line].slice(0, start) + " ".repeat(end - start) + out[line].slice(end);
  }
  return out;
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const VECTOR = String.raw`\[\s*${NUMBER}(?:\s*,\s*${NUMBER})*\s*\]`;
const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
/** A constant alone on its line: the one kind of statement a customizer offers, and safe to move for being one. */
const CONSTANT = new RegExp(
  String.raw`^\s*([A-Za-z_]\w*)\s*=\s*(${NUMBER}|${VECTOR}|${STRING}|true|false)\s*;\s*(//.*)?$`,
);

type Constant = { line: number; name: string; value: string; comment: string; heading: Heading | null };

function constantsOf(scanned: Scan, lines: string[]): Constant[] {
  const constants: Constant[] = [];
  let heading: Heading | null = null;
  let next = 0;
  lines.forEach((text, line) => {
    while (next < scanned.headings.length && scanned.headings[next].line < line) heading = scanned.headings[next++];
    const match = scanned.topLevel[line] ? CONSTANT.exec(text) : null;
    if (match) constants.push({ line, name: match[1], value: match[2], comment: match[3] ?? "", heading });
  });
  return constants;
}

const DEFAULT_FILE = /^"default\.(png|svg|stl)"$/;

/** The control a constant asks for that OpenSCAD has no word for, in MakerWorld's spelling. */
function widgetOf({ value, comment }: Constant): Pick<ScadParameter, "widget" | "accept"> | null {
  const file = DEFAULT_FILE.exec(value);
  if (file) return { widget: "file", accept: `.${file[1]}` };
  if (/^"#[0-9a-f]{6}"$/i.test(value) && /^\/\/\s*color\b/.test(comment)) return { widget: "color" };
  if (value.startsWith('"') && /^\/\/\s*font\b/.test(comment)) return { widget: "font" };
  return null;
}

/** The controls a script asks for beyond what the engine reports, by parameter name. */
export function scriptWidgets(source: string): Map<string, Pick<ScadParameter, "widget" | "accept">> {
  const scanned = scan(source);
  const widgets = new Map<string, Pick<ScadParameter, "widget" | "accept">>();
  for (const constant of constantsOf(scanned, withoutNotes(scanned))) {
    const widget = widgetOf(constant);
    if (widget) widgets.set(constant.name, widget);
  }
  return widgets;
}

/**
 * The script as the engine should be given it: with the parameters below its first `{` moved above it.
 *
 * Marked ones always: a `// [...]` widget, one of the controls above, or a heading of their own. The rest only when
 * the script would otherwise offer nothing, which is how MakerWorld reads it, because authors also hide their workings
 * below a first module on purpose (`module __Customizer_Limit__() {}`) and those should stay hidden. A name assigned
 * twice stays put, since moving one could change which of them wins.
 */
export function scriptForEngine(source: string): string {
  const scanned = scan(source);
  const lines = withoutNotes(scanned);
  const { firstBrace } = scanned;
  if (!firstBrace) return lines.join("\n");

  const visible = constantsOf(scanned, lines).filter((constant) => !/^hidden$/i.test(constant.heading?.name ?? ""));
  const above = visible.filter((constant) => constant.line < firstBrace.line);
  const below = visible.filter(
    (constant) =>
      constant.line >= firstBrace.line &&
      scanned.assigned.get(constant.name) === 1 &&
      // A brace in its own text would end the reading all over again.
      !lines[constant.line].includes("{"),
  );
  const marked = below.filter(
    (constant) =>
      /^\/\/\s*\[/.test(constant.comment) ||
      widgetOf(constant) !== null ||
      (constant.heading !== null && constant.heading.line > firstBrace.statement),
  );
  const moving = marked.length || above.length ? marked : below;
  if (!moving.length) return lines.join("\n");

  // Each under its own heading, and a heading first in any case: the comment above the module this lands in front of
  // would otherwise read as the first one's caption.
  const block: string[] = [];
  let group: string | null = null;
  for (const { line, heading } of moving) {
    const name = heading?.name ?? DEFAULT_GROUP;
    if (name !== group) block.push(`/* [${name}] */`);
    group = name;
    if (line > 0 && /^\s*\/\//.test(lines[line - 1])) block.push(lines[line - 1].trim());
    block.push(lines[line].trim());
  }
  const moved = new Set(moving.map((constant) => constant.line));
  const script: string[] = [];
  lines.forEach((text, line) => {
    if (line === firstBrace.statement) script.push(...block);
    if (!moved.has(line)) script.push(text);
  });
  return script.join("\n");
}

const CUBE = {
  vertices: Float64Array.from([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20]),
  triangles: Uint32Array.from([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]),
};
/** An 8x8 PNG of one mid grey. */
const GREY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAADklEQVR4nGNogAIGyhgAgIQgAQ2AJGEAAAAASUVORK5CYII=";

/**
 * Plain files for the ones a script reads until the reader chooses their own.
 *
 * MakerWorld's convention for a file parameter is a default called `default.png`, `.svg` or `.stl`. Without one to read
 * the engine makes nothing at all, and the customizer would open on an error rather than on a model.
 */
export function standInFiles(source: string): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  if (source.includes("default.png")) files["/default.png"] = Uint8Array.from(atob(GREY_PNG), (c) => c.charCodeAt(0));
  if (source.includes("default.svg")) {
    files["/default.svg"] =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>';
  }
  if (source.includes("default.stl")) files["/default.stl"] = writeStl(CUBE);
  return files;
}
