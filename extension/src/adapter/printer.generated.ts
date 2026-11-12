// GENERATED from backend/src/adapter/printer.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A copy made for the user's printer, for Bambu Studio and the slicers built on it. They load a project's printer,
// process and filament presets by name, and reset every setting the project's own list of changes
// (`different_settings_to_system`) doesn't name to that preset's value (PresetBundle::load_config_file_config). So the
// copy names the presets the slicer has for the user's printer: the printer exactly as the slicer has it, and the
// designer's changes on the matching process and filaments. Plates move onto that printer's bed, which the slicer
// lays out in a grid without moving what's on them. What the printer catalogue says about the printer comes in a
// PrinterRecipe, which only the backend can make.

import { asArray, firstValue, type Settings } from "./settings.generated";
import { parseTransform, formatTransform } from "./transform.generated";
import { parseAttrs } from "./xml.generated";
import type { PlateSettings } from "./readers/bambuProject.generated";

/** A slicer's filament presets for a printer, by filament type ("PLA") and by product ("bambu pla basic"). */
export type FilamentChoices = { types: Record<string, string>; products: Record<string, string> };

/** A printable area's bounding box, in mm in the printer's coordinates; `outline` set when the area isn't that box
 *  (a delta's round bed). */
export type BedBox = { minX: number; minY: number; maxX: number; maxY: number; outline?: boolean };

/** What a copy for one printer needs from the printer catalogue, for one slicer. */
export type PrinterRecipe = {
  /** The slicer's printer preset, and the printer model it belongs to. */
  preset: string;
  model: string | null;
  /** In mm. */
  nozzle: number;
  extruders: number;
  /** The process presets the printer preset can use. */
  processes: { name: string; layerHeight: number | null }[];
  defaultProcess: string | null;
  /** The filaments made for this printer, then the slicer's for every printer. */
  filaments: FilamentChoices | null;
  everyPrinter: FilamentChoices | null;
  bed: BedBox | null;
  height: number | null;
};

/**
 * The product a filament preset is for: its name without the printer it's tuned for ("Bambu PLA Basic @BBL A1M",
 * "Anker Generic PLA 0.2 nozzle"), lower case. Slicers give one product different ids (Bambu Studio's GFA00 is
 * OrcaSlicer's OFoiVqVM) but the same name. scripts/printers/lib/orca.mjs keys the catalogue's products the same way.
 */
export function filamentProduct(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/\s+@.*$/, "")
    .replace(/\s+\d+(?:\.\d+)?\s*(?:mm\s*)?nozzle$/i, "")
    .trim()
    .toLowerCase();
}

/** "0.20mm Standard @BBL A1M" -> 0.2 and "standard"; "0.20 Standard @Snapmaker U1 (0.4 nozzle)" the same. */
export function processNameParts(name: string): { height: number | null; quality: string | null } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s+([^@]*?)\s*(?:@.*)?$/i.exec(name);
  if (!m) return { height: null, quality: null };
  const height = Number(m[1]);
  return { height: Number.isFinite(height) && height > 0 ? height : null, quality: m[2].trim().toLowerCase() || null };
}

const SAME_HEIGHT = 0.005;

/**
 * The process preset to put the designer's changes on: the designer's own when the printer can use it, else the
 * printer's process at the height and quality the designer's started from ("0.20mm Strength"), which their changes
 * were made on top of. `layerHeight` stands in for a name that has no height.
 */
export function chooseProcess(
  recipe: PrinterRecipe,
  designerProcess: string,
  layerHeight: number | null,
): string | null {
  const processes = recipe.processes;
  if (processes.some((p) => p.name === designerProcess)) return designerProcess;
  const wanted = processNameParts(designerProcess);
  const height = wanted.height ?? layerHeight;
  const quality = wanted.quality;
  const heightOf = (p: { name: string; layerHeight: number | null }) =>
    p.layerHeight ?? processNameParts(p.name).height;
  const rank = (p: { name: string; layerHeight: number | null }) => {
    const q = processNameParts(p.name).quality;
    if (quality && q === quality) return 0;
    if (q === "standard") return 1;
    if (p.name === recipe.defaultProcess) return 2;
    return 3;
  };
  const pick = (list: { name: string; layerHeight: number | null }[]) =>
    list.toSorted((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
  if (height !== null && processes.length) {
    const same = processes.filter((p) => {
      const h = heightOf(p);
      return h !== null && Math.abs(h - height) < SAME_HEIGHT;
    });
    if (same.length) return pick(same).name;
    const measured = processes.filter((p) => heightOf(p) !== null);
    if (measured.length) {
      const nearest = Math.min(...measured.map((p) => Math.abs((heightOf(p) as number) - height)));
      return pick(measured.filter((p) => Math.abs(Math.abs((heightOf(p) as number) - height) - nearest) < 1e-9)).name;
    }
  }
  return recipe.defaultProcess ?? processes[0]?.name ?? null;
}

function lookup(map: Record<string, string> | undefined, key: string): string | null {
  if (!map || !key) return null;
  if (Object.hasOwn(map, key)) return map[key];
  const lower = key.toLowerCase();
  const found = Object.keys(map).find((k) => k.toLowerCase() === lower);
  return found ? map[found] : null;
}

/** A filament type's material: PETG of "PETG-CF" and "PETG HF", PLA of "PLA Silk". */
const material = (type: string) => type.trim().split(/[\s-]/)[0].toUpperCase();

/** The filament type `preset` is the printer's preset for, if it's one: the catalogue keeps no other preset's type. */
function typeNamed(recipe: PrinterRecipe, preset: string): string | null {
  for (const types of [recipe.filaments?.types, recipe.everyPrinter?.types]) {
    const found = Object.entries(types ?? {}).find(([, name]) => name === preset);
    if (found) return found[0];
  }
  return null;
}

/**
 * The filament preset for one of the designer's filaments: the same product made for this printer, else for every
 * printer, else the printer's preset for that filament type. A product the printer names for another material gives
 * way to that type's preset: the designer changed the type of a preset whose name they kept. Null when the slicer has
 * none of that type for the printer: the designer's own preset stays, because another material's would set what the
 * designer's list of changes doesn't name (its temperatures) to that material's.
 */
export function chooseFilament(
  recipe: PrinterRecipe,
  designer: { name: string; inherits: string; type: string },
): string | null {
  const ofType = lookup(recipe.filaments?.types, designer.type) ?? lookup(recipe.everyPrinter?.types, designer.type);
  for (const key of [filamentProduct(designer.name), filamentProduct(designer.inherits)]) {
    const name = lookup(recipe.filaments?.products, key) ?? lookup(recipe.everyPrinter?.products, key);
    if (!name) continue;
    const type = typeNamed(recipe, name);
    // Only for a type the printer has a preset of: one it hasn't may be another slicer's name for the same material.
    if (ofType && type && material(type) !== material(designer.type)) continue;
    return name;
  }
  return ofType;
}

/** The bounding box of `printable_area` ("XxY" points), or null without two distinct points. */
export function bedBoxOf(area: unknown): BedBox | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of asArray(area)) {
    const [x, y] = String(point).split("x").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < 2) return null;
  const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return box.maxX > box.minX && box.maxY > box.minY ? box : null;
}

// The slicers place plate i of n at column i % cols, row i / cols, one plate size and a fifth apart
// (PartPlateList::compute_shape_position, LOGICAL_PART_PLATE_GAP); the plate size is the bed's, truncated to whole
// millimetres (it's an int, PartPlateList::reset_size).
const PLATE_GAP = 0.2;

/** The slicers' column count for n plates: the square root, rounded up when rounding took it down. */
export function plateColumns(count: number): number {
  const root = Math.sqrt(count);
  const rounded = Math.round(root);
  return root > rounded ? rounded + 1 : Math.max(rounded, 1);
}

const plateStride = (size: number) => Math.trunc(size) * (1 + PLATE_GAP);

/** Where plate `index` of a grid `columns` wide starts, in the slicers' layout for `bed`. */
export function plateOrigin(index: number, columns: number, bed: BedBox): [number, number] {
  const col = index % columns;
  const row = Math.floor(index / columns);
  return [col * plateStride(bed.maxX - bed.minX), -row * plateStride(bed.maxY - bed.minY)];
}

export const bedCentre = (bed: BedBox): [number, number] => [(bed.minX + bed.maxX) / 2, (bed.minY + bed.maxY) / 2];
const centre = bedCentre;

/**
 * How far each plate's objects move, keyed `<object id>:<instance>` as model_settings.config lists them: from the
 * middle of the plate on the designer's bed to the middle of the same plate on the printer's. Objects on no plate
 * stay put.
 */
export function plateMoves(plates: PlateSettings[], from: BedBox, to: BedBox): Map<string, [number, number]> {
  const moves = new Map<string, [number, number]>();
  const columns = plateColumns(plates.length);
  const [fromX, fromY] = centre(from);
  const [toX, toY] = centre(to);
  plates.forEach((plate, index) => {
    const [ax, ay] = plateOrigin(index, columns, from);
    const [bx, by] = plateOrigin(index, columns, to);
    const move: [number, number] = [bx - ax + toX - fromX, by - ay + toY - fromY];
    for (const inst of plate.instances) moves.set(`${inst.objectId}:${inst.instanceId}`, move);
  });
  return moves;
}

/** The build section with each placed item moved; null when nothing moves. */
export function moveBuildItems(buildXml: string, moves: Map<string, [number, number]>): string | null {
  const seen: Record<string, number> = {};
  let moved = false;
  const out = buildXml.replace(/<item\b([^>]*?)(\/?)>/gi, (whole, attrStr: string, close: string) => {
    const attrs = parseAttrs(attrStr);
    if (!attrs.objectid) return whole;
    const instance = seen[attrs.objectid] ?? 0;
    seen[attrs.objectid] = instance + 1;
    const move = moves.get(`${attrs.objectid}:${instance}`);
    if (!move || (Math.abs(move[0]) < 1e-9 && Math.abs(move[1]) < 1e-9)) return whole;
    moved = true;
    const m = parseTransform(attrs.transform);
    m[9] += move[0];
    m[10] += move[1];
    const transform = `transform="${formatTransform(m)}"`;
    const rest = /\btransform\s*=\s*"[^"]*"/i.test(attrStr)
      ? attrStr.replace(/\btransform\s*=\s*"[^"]*"/i, transform)
      : `${attrStr} ${transform}`;
    return `<item${rest}${close}>`;
  });
  return moved ? out : null;
}

// wipe_tower_x/y is the tower's front-left corner on its plate; the tower reaches prime_tower_width (and, with a rib
// wall, its extra rib length) to the right and back, with its brim all round. Process presets set the width (Bambu's
// 35 mm); a project may carry more.
const TOWER_WIDTH = 35;
const TOWER_BRIM = 5;
// Room for line width and rounding.
const TOWER_SLACK = 2;

function positive(value: unknown, fallback: number): number {
  const n = Number(firstValue(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Each plate's wipe tower moved as its objects were and kept on the printer's bed, or null without towers. */
export function moveWipeTowers(settings: Settings, from: BedBox, to: BedBox): { x: string[]; y: string[] } | null {
  const xs = asArray(settings.wipe_tower_x);
  const ys = asArray(settings.wipe_tower_y);
  if (!xs.length || !ys.length) return null;
  const width = Math.max(positive(settings.prime_tower_width, 0), TOWER_WIDTH);
  const ribs =
    firstValue(settings.wipe_tower_wall_type) === "rib" ? positive(settings.wipe_tower_extra_rib_length, 0) : 0;
  const before = positive(settings.prime_tower_brim_width, TOWER_BRIM) + TOWER_SLACK;
  const after = width + ribs + before;
  const [fromX, fromY] = centre(from);
  const [toX, toY] = centre(to);
  const place = (value: unknown, shift: number, lo: number, hi: number): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    // A tower wider than the bed stays at the near edge; the slicer says it doesn't fit when it slices.
    const clamped = Math.min(Math.max(n + shift, lo + before), Math.max(hi - after, lo + before));
    return String(Math.round(clamped * 1000) / 1000);
  };
  return {
    x: xs.map((x) => place(x, toX - fromX, to.minX, to.maxX)),
    y: ys.map((y) => place(y, toY - fromY, to.minY, to.maxY)),
  };
}

// A printer's own G-code, which the slicer takes from the printer preset; left out so a slicer without that preset
// doesn't run the designer's printer's start sequence on another printer.
const MACHINE_GCODE = [
  "machine_start_gcode",
  "machine_end_gcode",
  "before_layer_change_gcode",
  "layer_change_gcode",
  "change_filament_gcode",
  "machine_pause_gcode",
  "template_custom_gcode",
  "time_lapse_gcode",
  "printing_by_object_gcode",
  "change_extrusion_role_gcode",
  "wrapping_detection_gcode",
];

function strings(value: unknown): string[] {
  return asArray(value).map((v) => String(v ?? ""));
}

function sized(list: string[], length: number): string[] {
  return Array.from({ length }, (_, i) => list[i] ?? "");
}

const mm = (n: number) => String(Math.round(n * 1000) / 1000);

// The slicers lay a project's settings over their own defaults, which have one filament in this colour
// (PrintConfig.cpp), so a project without a colour list loads only its first filament.
export const SLICER_DEFAULT_COLOUR = "#F2754E";

/** The bed as `printable_area` writes it. */
export function rectangle(bed: BedBox): string[] {
  return [
    `${mm(bed.minX)}x${mm(bed.minY)}`,
    `${mm(bed.maxX)}x${mm(bed.minY)}`,
    `${mm(bed.maxX)}x${mm(bed.maxY)}`,
    `${mm(bed.minX)}x${mm(bed.maxY)}`,
  ];
}

export type RetargetResult = {
  settings: Settings;
  process: string | null;
  filaments: string[];
  /** The designer's bed, which plates move from; null when the project doesn't say. */
  from: BedBox | null;
};

/**
 * The project's settings for `recipe`'s printer: its presets named, the designer's changes listed against them, the
 * printer's slot of that list emptied so the printer is the slicer's own, and the wipe towers moved. Settings stay
 * otherwise as they were: the slicer keeps those the list names and resets the rest to the presets.
 */
export function retargetSettings(config: Settings, recipe: PrinterRecipe): RetargetResult {
  const out: Settings = { ...config };
  // Each filament has a preset; a colour list may be missing or shorter.
  const count = Math.max(strings(config.filament_settings_id).length, strings(config.filament_colour).length, 1);
  const inherits = sized(strings(config.inherits_group), count + 2);
  const diff = sized(strings(config.different_settings_to_system), count + 2);

  const designerProcess = inherits[0] || String(firstValue(config.print_settings_id) ?? "");
  const layerHeight = Number(firstValue(config.layer_height));
  const process = chooseProcess(recipe, designerProcess, Number.isFinite(layerHeight) ? layerHeight : null);
  if (process) out.print_settings_id = process;

  const names = sized(strings(config.filament_settings_id), count);
  const types = sized(strings(config.filament_type), count);
  const filaments = names.map(
    (name, i) => chooseFilament(recipe, { name, inherits: inherits[i + 1], type: types[i] }) ?? name,
  );
  out.filament_settings_id = filaments;

  out.printer_settings_id = recipe.preset;
  if (recipe.model) out.printer_model = recipe.model;
  out.inherits_group = Array.from({ length: count + 2 }, () => "");
  diff[count + 1] = "";
  out.different_settings_to_system = diff;
  out.print_compatible_printers = [recipe.preset];
  if (config.compatible_machine_expression_group !== undefined)
    out.compatible_machine_expression_group = Array.from({ length: count + 2 }, () => "");
  if (config.compatible_process_expression_group !== undefined)
    out.compatible_process_expression_group = Array.from({ length: count }, () => "");
  for (const key of MACHINE_GCODE) delete out[key];

  // Used only where the slicer doesn't have the printer's preset and builds one from the file: the bed at least is
  // the printer's. Per-extruder values stay the designer's, all the same length.
  if (recipe.bed && !recipe.bed.outline) out.printable_area = rectangle(recipe.bed);
  if (recipe.height) out.printable_height = String(recipe.height);

  // Filaments on an extruder the printer doesn't have go on its first.
  if (config.filament_map !== undefined)
    out.filament_map = strings(config.filament_map).map((v) => (Number(v) > recipe.extruders ? "1" : v));
  // Snapmaker Orca 2.4 drops tool changes when this is shorter than the filament list (its issue #1124). A colour
  // list shorter than the presets gets the same: the last colour for the filaments it doesn't name.
  for (const key of ["filament_adhesiveness_category", "filament_colour"]) {
    const list = strings(config[key]);
    if (list.length && list.length < count) out[key] = sized(list, count).map((v) => v || list[list.length - 1]);
  }
  // Without one, or with an empty one (which Bambu Studio and OrcaSlicer refuse), each filament gets the colour the
  // slicer would give the first, so every one of them loads.
  if (!strings(config.filament_colour).length)
    out.filament_colour = Array.from({ length: count }, () => SLICER_DEFAULT_COLOUR);

  const from = bedBoxOf(config.printable_area);
  if (from && recipe.bed) {
    const towers = moveWipeTowers(config, from, recipe.bed);
    if (towers) {
      out.wipe_tower_x = towers.x;
      out.wipe_tower_y = towers.y;
    }
  }
  return { settings: out, process, filaments, from };
}
