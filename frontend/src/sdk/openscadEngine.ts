// Running OpenSCAD: the engine in `assets/openscad`, wrapped in the two things a customizer actually needs --
// what parameters a script offers, and the model that comes out of a given set of them.
//
// This half runs inside the worker. Rendering holds its thread for as long as it takes, which is seconds for
// anything the size of a real generator, so it is kept off the one drawing the page: see openscad.ts, which is
// what a tool actually calls. Nothing here leaves the instance -- the script, the parameters and the result
// all stay in the tab.

import OpenSCAD from "../assets/openscad/openscad.js";
import { TOOL_FONT_URLS } from "./fonts";
import { LIBRARY_FILES, libraryPath, SCAD_LIBRARIES } from "./scadLibraries";
import type { ScadParameters, ScadRender, ScadRenderOptions } from "./types";

// What a tool sees of OpenSCAD -- the parameters, the render and its options -- is declared in types.ts, which the
// SDK reference is written from.
//
// 3MF is the default format and is Thingport's own: the WebAssembly build is made without lib3mf, and asked for one
// directly it renders, writes nothing and exits as though it had worked. So the engine is asked for OFF, which lists
// each vertex once, and that is turned into a 3MF here. The difference is not small -- a generator's output is tens
// of megabytes as the ASCII STL the engine writes, against a couple as a 3MF. The rest are the engine's own, for a
// tool that wants what it writes untouched.
export type { ScadFormat, ScadParameter, ScadParameters, ScadRender, ScadRenderOptions } from "./types";

type Instance = {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string): Uint8Array;
    chdir(path: string): void;
  };
  callMain(args: string[]): number;
};

/** Compiled once and instantiated per run: `callMain` can't be trusted to run twice in one instance, but the
 *  compile is the slow part and a WebAssembly.Module is reusable. */
let compiled: Promise<WebAssembly.Module> | null = null;

function compiledEngine(): Promise<WebAssembly.Module> {
  if (!compiled) {
    compiled = (async () => {
      const wasm = await import("../assets/openscad/openscad.wasm?url");
      const res = await fetch(wasm.default);
      if (!res.ok) throw new Error(`The OpenSCAD engine didn't load (HTTP ${res.status})`);
      return WebAssembly.compile(await res.arrayBuffer());
    })();
    compiled.catch(() => (compiled = null));
  }
  return compiled;
}

async function newInstance(log: string[]): Promise<Instance> {
  const engine = await compiledEngine();
  const instance = (await OpenSCAD({
    noInitialRun: true,
    print: (line: string) => log.push(line),
    printErr: (line: string) => log.push(line),
    instantiateWasm: (
      imports: WebAssembly.Imports,
      success: (inst: WebAssembly.Instance, mod: WebAssembly.Module) => void,
    ) => {
      WebAssembly.instantiate(engine, imports).then((inst) => success(inst, engine));
      return {};
    },
  })) as Instance;
  // The engine looks for both beside the working directory, and says so only in passing if they're missing.
  instance.FS.chdir("/");
  mkdirp(instance, "/locale");
  return instance;
}

function mkdirp(instance: Instance, path: string): void {
  let built = "";
  for (const part of path.split("/").filter(Boolean)) {
    built += `/${part}`;
    try {
      instance.FS.mkdir(built);
    } catch {
      // Already there, which is the common case once fonts and libraries share a parent.
    }
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read ${url} (HTTP ${res.status})`);
  return res.text();
}

/** Mounts only what the script asks for: an ordinary script pays for neither. */
async function mountDependencies(instance: Instance, source: string, log: string[]): Promise<void> {
  const wanted = SCAD_LIBRARIES.filter((name) => source.includes(name));
  if (wanted.length) {
    mkdirp(instance, "/libraries");
    const files = Object.entries(LIBRARY_FILES).filter(([key]) =>
      wanted.some((name) => libraryPath(key).startsWith(`${name}/`)),
    );
    await Promise.all(
      files.map(async ([key, load]) => {
        const path = `/libraries/${libraryPath(key)}`;
        mkdirp(instance, path.slice(0, path.lastIndexOf("/")));
        instance.FS.writeFile(path, await fetchText(await load()));
      }),
    );
  }

  if (!/\btext\s*\(|\bfont\b/i.test(source)) return;
  mkdirp(instance, "/fonts");
  // An empty config is what the engine's own playground mounts: fontconfig only has to find the folder.
  instance.FS.writeFile(
    "/fonts/fonts.conf",
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n</fontconfig>\n',
  );
  await Promise.all(
    [...TOOL_FONT_URLS].map(async ([id, url]) => {
      try {
        const res = await fetch(url);
        instance.FS.writeFile(`/fonts/${id}.ttf`, new Uint8Array(await res.arrayBuffer()));
      } catch {
        log.push(`WARNING: the typeface ${id} didn't load, so a script asking for it will fall back.`);
      }
    }),
  );
}

/** A value as the customizer's parameter file writes it: every one a string, vectors in brackets. */
function parameterValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

async function run(
  source: string,
  args: string[],
  outputPath: string,
  extraFiles: Record<string, string> = {},
): Promise<ScadRender> {
  const log: string[] = [];
  const instance = await newInstance(log);
  await mountDependencies(instance, source, log);
  instance.FS.writeFile("/model.scad", source);
  for (const [path, content] of Object.entries(extraFiles)) instance.FS.writeFile(path, content);

  const started = Date.now();
  // Manifold, not the CGAL the engine still falls back to: the same script is minutes against seconds, and on
  // anything the size of a real generator the difference is the feature working or not.
  instance.callMain(["/model.scad", "--backend=Manifold", "-o", outputPath, ...args]);
  const seconds = (Date.now() - started) / 1000;

  let bytes: Uint8Array | null = null;
  try {
    bytes = instance.FS.readFile(outputPath);
  } catch {
    // No file at all, which is what a script that failed to parse leaves behind.
  }
  // An empty file counts as a failure: asked for a format the engine wasn't built with, it renders the model,
  // writes nothing and exits as though it had worked.
  if (!bytes?.length) {
    const said = log.filter((line) => /error|not enabled|warning: (?:unknown|ignoring)/i.test(line));
    throw new Error(said.length ? said.join("\n") : "OpenSCAD produced nothing, and didn't say why.");
  }
  return { bytes, log, seconds };
}

/** What the script offers to change, as OpenSCAD itself reads it -- groups, ranges, captions and choices. */
export async function scadParameters(source: string): Promise<ScadParameters> {
  const { bytes } = await run(source, ["--export-format", "param"], "/parameters.json");
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ScadParameters>;
  return { title: parsed.title ?? "", parameters: parsed.parameters ?? [] };
}

/** The model the script makes with the parameters given. */
export async function scadRender(source: string, options: ScadRenderOptions = {}): Promise<ScadRender> {
  const wanted = options.format ?? "3mf";
  // A 3MF is made here from the engine's OFF, and "mesh" is the same read without writing anything: both come
  // back from the engine as OFF. Everything else it writes itself.
  const made = wanted === "3mf" || wanted === "mesh";
  const asked = made ? "off" : wanted;
  const entries = Object.entries(options.parameters ?? {});

  let args: string[] = [];
  let extra: Record<string, string> = {};
  if (entries.length) {
    // Through a parameter set rather than -D: the engine does its own typing, so a value holding a bracket or a
    // quote can't turn into something else on the way through a command line.
    const set = Object.fromEntries(entries.map(([name, value]) => [name, parameterValue(value)]));
    args = ["-p", "/parameters.json", "-P", "thingport"];
    extra = { "/parameters.json": JSON.stringify({ parameterSets: { thingport: set }, fileFormatVersion: "1" }) };
  }

  const rendered = await run(source, args, `/model.${asked}`, extra);
  if (!made) return rendered;
  const { parseOff, writeThreeMf } = await import("./threeMf");
  const mesh = parseOff(new TextDecoder().decode(rendered.bytes));
  // Asked for the geometry alone, nothing is written: building a 3MF of a big model is seconds of held thread,
  // and a tool that only wants the mesh was paying that for bytes it threw away.
  if (wanted === "mesh") return { ...rendered, mesh };
  return { ...rendered, bytes: writeThreeMf(mesh, { name: options.name }), mesh };
}
