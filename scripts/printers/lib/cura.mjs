// The printers of UltiMaker Cura's machine definitions (resources/definitions/*.def.json). A definition inherits from
// another down to fdmprinter, a child's keys winning and nested objects merging, as Uranium does; every visible one
// but fdmprinter and fdmextruder is a printer. A setting's value is the definition's literal `value`, else its
// `default_value`, else fdmprinter's. Nozzles come from resources/variants (*.inst.cfg, hardware_type nozzle).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));

function merge(child, parent) {
  const out = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])
        ? merge(v, out[k])
        : v;
  }
  return out;
}

function settingDefaults(tree, out = {}) {
  for (const [k, v] of Object.entries(tree ?? {})) {
    if (!v || typeof v !== "object") continue;
    if ("default_value" in v || "value" in v) out[k] = v;
    if (v.children) settingDefaults(v.children, out);
  }
  return out;
}

/** A setting's value when it's written as a literal, not a formula. */
function literal(v) {
  if (typeof v === "number" || typeof v === "boolean" || Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "True" || s === "true") return true;
  if (s === "False" || s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.length >= 2 && s[0] === s.at(-1) && `'"`.includes(s[0]) && s.split(s[0]).length === 3) return s.slice(1, -1);
  return null;
}

/** A nozzle variant's size: "AA 0.4" and "V6 0.40mm" are 0.4, "IDEX420 Laiton 0.6" 0.6, a print core ("1A") none. */
function variantSize(name) {
  const decimal = /(\d+\.\d+)/.exec(name);
  if (decimal) return Number(decimal[1]);
  const mm = /(?:^|\s)(\d+)\s*mm\b/i.exec(name);
  return mm ? Number(mm[1]) : null;
}

function readCfg(file) {
  const sections = {};
  let current = null;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      current = sections[line.slice(1, -1).trim()] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (current && eq > 0) current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function* files(dir, suffix) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full, suffix);
    else if (entry.name.endsWith(suffix)) yield full;
  }
}

export function readCuraDefinitions(sourceDir) {
  const res = path.join(sourceDir, "resources");
  const raw = new Map();
  for (const file of files(path.join(res, "definitions"), ".def.json")) {
    raw.set(path.basename(file).slice(0, -".def.json".length), readJson(file));
  }
  const cache = new Map();
  const resolved = (id, seen = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    const def = raw.get(id);
    if (!def) return {};
    const parent = def.inherits && !seen.has(def.inherits) ? resolved(def.inherits, new Set(seen).add(id)) : {};
    const { inherits: _inherits, ...own } = def;
    const merged = merge(own, parent);
    cache.set(id, merged);
    return merged;
  };
  const FDM = settingDefaults(raw.get("fdmprinter")?.settings);
  const get = (def, key) => {
    const own = def.overrides?.[key] ?? {};
    for (const src of [own, FDM[key] ?? {}]) {
      if ("value" in src) {
        const v = literal(src.value);
        if (v !== null) return v;
        if (src === own) return null; // A formula of the printer's own: unknown here.
      }
      if ("default_value" in src) return src.default_value;
    }
    return null;
  };

  const nozzlesOf = new Map();
  for (const file of files(path.join(res, "variants"), ".inst.cfg")) {
    const cfg = readCfg(file);
    if (cfg.metadata?.type !== "variant" || (cfg.metadata?.hardware_type ?? "nozzle") !== "nozzle") continue;
    const def = cfg.general?.definition;
    if (!def) continue;
    if (!nozzlesOf.has(def)) nozzlesOf.set(def, []);
    nozzlesOf.get(def).push(cfg.general.name);
  }

  const byManufacturer = new Map();
  for (const id of [...raw.keys()].sort()) {
    if (id === "fdmprinter" || id === "fdmextruder") continue;
    const def = resolved(id);
    if (def.metadata?.visible === false || raw.get(id).metadata?.visible === false) continue;
    const width = get(def, "machine_width");
    const depth = get(def, "machine_depth");
    const elliptic = get(def, "machine_shape") === "elliptic";
    const centred = get(def, "machine_center_is_zero") === true;
    const bed =
      typeof width === "number" && typeof depth === "number"
        ? {
            shape: elliptic ? "circle" : "rectangle",
            x: width,
            y: depth,
            origin: centred ? [-width / 2, -depth / 2] : [0, 0],
            ...(elliptic ? { diameter: Math.max(width, depth) } : {}),
          }
        : null;
    const disallowed = get(def, "machine_disallowed_areas");
    const trains = def.metadata?.machine_extruder_trains ?? {};
    const count = get(def, "machine_extruder_count");
    const variants = (nozzlesOf.get(id) ?? []).sort();
    const nozzle = get(def, "machine_nozzle_size");
    const height = get(def, "machine_height");
    const relative = get(def, "relative_extrusion");
    const manufacturer = def.metadata?.manufacturer ?? "";
    if (!byManufacturer.has(manufacturer)) byManufacturer.set(manufacturer, []);
    byManufacturer.get(manufacturer).push({
      name: def.name ?? id,
      modelId: id,
      family: null,
      cover: null,
      variants: [
        {
          preset: id,
          nozzle: null,
          nozzleVariants: variants,
          nozzleSizes: [...new Set(variants.map(variantSize).filter((n) => n !== null))],
          defaultNozzle: typeof nozzle === "number" ? nozzle : null,
          extruders: typeof count === "number" ? count : Object.keys(trains).length || 1,
          bed,
          exclude: Array.isArray(disallowed) && disallowed.length ? disallowed : null,
          extruderBeds: null,
          height: typeof height === "number" ? height : null,
          gcodeFlavor: get(def, "machine_gcode_flavor"),
          relativeE: typeof relative === "boolean" ? relative : null,
          structure: null,
          defaultProcess: null,
          processes: [],
          multiMaterial: [],
          materialDiameter: get(def, "material_diameter"),
          temps: {
            nozzle: literal(def.overrides?.material_print_temperature?.maximum_value),
            bed: literal(def.overrides?.material_bed_temperature?.maximum_value),
            chamber: literal(def.overrides?.build_volume_temperature?.maximum_value),
          },
        },
      ],
    });
  }
  return {
    vendors: [...byManufacturer].map(([name, models]) => ({ dir: null, name, version: null, models })),
    problems: [],
    devices: {},
  };
}
