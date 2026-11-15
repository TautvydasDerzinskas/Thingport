// Cuts Thingport Grab's copy of the printer catalogue from the server's (backend/assets/printers, made by
// npm run printers:update) into extension/public/printers. Grab makes copies for a printer without an instance, so it
// needs the catalogue too, but only what a copy needs: every printer to list, and the presets of the slicers that load
// a printer's presets by name (`targetsPrinter` in backend/src/adapter/slicers/), with the process lists and filament
// maps a brand's presets share written once. No pictures: Grab draws its printers. The copy is committed, as the
// extension builds from its own folder:
//
//   npm run printers:sync    rewrite it
//   npm run printers:check   fail when it's out of date (CI)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "backend/assets/printers");
const SLICERS = path.join(ROOT, "backend/src/adapter/slicers");
const TARGET = "extension/public/printers";

/** Bumped when the files' shape changes, with CATALOGUE_VERSION in extension/src/printers/catalogue.ts. */
export const GRAB_CATALOGUE_VERSION = 1;

const readJson = (file) => JSON.parse(readFileSync(path.join(SOURCE, file), "utf8"));

/** The slicers whose profile says they load a printer's presets by name. */
function printerSlicers() {
  const ids = [];
  for (const file of readdirSync(SLICERS)) {
    if (!file.endsWith(".ts") || file === "index.ts" || file === "types.ts") continue;
    const text = readFileSync(path.join(SLICERS, file), "utf8");
    const id = /^\s*id:\s*"([^"]+)"/m.exec(text)?.[1];
    if (id && /^\s*targetsPrinter:\s*true/m.test(text)) ids.push(id);
  }
  return ids.sort();
}

/** One line per entry of an object or array, the rest compact: small, and a catalogue update diffs by printer. */
function lines(value) {
  if (Array.isArray(value)) return `[\n${value.map((item) => JSON.stringify(item)).join(",\n")}\n]`;
  return `{\n${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)}:${JSON.stringify(item)}`)
    .join(",\n")}\n}`;
}
const file = (head, body) =>
  `{${Object.entries(head)
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`)
    .join("\n")}\n${body}}\n`;

/** A pool of values written once, by their JSON, which presets name by index. */
function pool() {
  const items = [];
  const seen = new Map();
  return {
    items,
    ref(value) {
      const key = JSON.stringify(value);
      if (!seen.has(key)) {
        seen.set(key, items.length);
        items.push(value);
      }
      return seen.get(key);
    },
  };
}

/** The slicers of `slicers` that have a preset for the printer. */
const presetSlicers = (p, slicers) =>
  slicers.filter((slicer) => p.slicers?.[slicer]?.some((entry) => Object.keys(entry.presets ?? {}).length));

function brandFile(printers, slicers) {
  const processes = pool();
  const filaments = pool();
  const out = {};
  for (const p of printers) {
    if (!presetSlicers(p, slicers).length) continue;
    const entries = {};
    for (const slicer of slicers) {
      // Every entry with presets, an empty list's included: the recipe picks among them as the server does.
      const listed = (p.slicers?.[slicer] ?? []).filter((entry) => entry.presets);
      if (!listed.length) continue;
      entries[slicer] = listed.map((entry) => ({
        ...(entry.config ? { config: entry.config } : {}),
        ...(entry.model ? { model: entry.model } : {}),
        presets: Object.fromEntries(
          Object.entries(entry.presets).map(([nozzle, presets]) => [
            nozzle,
            presets.map((preset) => ({
              name: preset.name,
              ...(preset.defaultProcess ? { defaultProcess: preset.defaultProcess } : {}),
              ...(preset.processes ? { processes: processes.ref(preset.processes) } : {}),
              ...(preset.filaments ? { filaments: filaments.ref(preset.filaments) } : {}),
            })),
          ]),
        ),
      }));
    }
    const bed = p.bed ? { shape: p.bed.shape, x: p.bed.x, y: p.bed.y, origin: p.bed.origin } : null;
    out[p.id] = { extruders: p.extruders, bed, height: p.height, slicers: entries };
  }
  if (!Object.keys(out).length) return null;
  return file(
    { version: GRAB_CATALOGUE_VERSION },
    `"processes":${lines(processes.items)},\n"filaments":${lines(filaments.items)},\n"printers":${lines(out)}`,
  );
}

/** Every file of Grab's copy, by its path under TARGET. */
export function grabCatalogue() {
  const slicers = printerSlicers();
  const index = readJson("index.json");
  const wanted = new Map();
  const known = new Map();
  for (const brand of index.brands) {
    const { printers } = readJson(path.join("brands", `${brand.id}.json`));
    const text = brandFile(printers, slicers);
    if (text) wanted.set(`brands/${brand.id}.json`, text);
    for (const p of printers) known.set(p.id, presetSlicers(p, slicers));
  }
  const everyPrinter = [];
  for (const slicer of slicers) {
    const from = path.join("filaments", `${slicer}.json`);
    if (!existsSync(path.join(SOURCE, from))) continue;
    const { types, products } = readJson(from);
    everyPrinter.push(slicer);
    wanted.set(`filaments/${slicer}.json`, `${JSON.stringify({ version: GRAB_CATALOGUE_VERSION, types, products })}\n`);
  }
  const printers = index.printers.map((p) => ({
    id: p.id,
    brand: p.brand,
    model: p.model,
    bed: p.bed ? { shape: p.bed.shape, x: p.bed.x, y: p.bed.y } : null,
    height: p.height,
    nozzles: p.nozzles,
    extruders: p.extruders,
    ...(known.get(p.id)?.length ? { slicers: known.get(p.id) } : {}),
  }));
  // `filaments`: the slicers with a filaments/<slicer>.json, so Grab never asks for one that isn't there.
  wanted.set(
    "index.json",
    file(
      { version: GRAB_CATALOGUE_VERSION, slicers, filaments: everyPrinter },
      `"brands":${lines(index.brands.map(({ id, name, printers: count }) => ({ id, name, printers: count })))},\n"printers":${lines(printers)}`,
    ),
  );
  return wanted;
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

/** Brings Grab's copy up to date, or with `check` only says what isn't: the files that were or would be written. */
export function syncGrabCatalogue({ check = false } = {}) {
  const targetDir = path.join(ROOT, TARGET);
  const wanted = grabCatalogue();
  const stale = [];
  for (const [rel, text] of wanted) {
    const at = path.join(targetDir, rel);
    if (existsSync(at) && readFileSync(at, "utf8") === text) continue;
    stale.push(`${TARGET}/${rel}`);
    if (!check) {
      mkdirSync(path.dirname(at), { recursive: true });
      writeFileSync(at, text);
    }
  }
  for (const rel of filesUnder(targetDir)) {
    if (wanted.has(rel)) continue;
    stale.push(`${TARGET}/${rel} (no longer in the catalogue)`);
    if (!check) rmSync(path.join(targetDir, rel));
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale = syncGrabCatalogue({ check });
  if (check && stale.length) {
    console.error(`Grab's printer catalogue is out of date; run npm run printers:sync:\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  if (!check) console.log(stale.length ? `Wrote ${stale.length} file(s) of Grab's printer catalogue.` : "Up to date.");
}
