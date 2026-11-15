// The FFF printers of PrusaSlicer's vendor bundles (resources/profiles/<Vendor>.ini): [printer_model:ID] sections
// name the printers, [printer:Name] presets their nozzle variants and [print:Name] presets the processes. A preset
// named *like this* is abstract; `inherits` may list several parents ("a; b"), applied in order, then its own keys.
// A print preset fits a printer by its compatible_printers list or its compatible_printers_condition.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Condition } from "./condition.mjs";
import { bedGeometry, nozzleName, parsePoints } from "./geometry.mjs";

// PrusaSlicer's own defaults (PrintConfig.cpp) for keys no preset sets.
const DEFAULTS = {
  bed_shape: "0x0,200x0,200x200,0x200",
  max_print_height: "200",
  gcode_flavor: "reprap",
  use_relative_e_distances: "0",
  nozzle_diameter: "0.4",
  single_extruder_multi_material: "0",
  printer_technology: "FFF",
};

function parseIni(text) {
  const sections = [];
  let current = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      const body = line.slice(1, -1);
      const at = body.indexOf(":");
      current = {
        kind: (at < 0 ? body : body.slice(0, at)).trim(),
        name: at < 0 ? "" : body.slice(at + 1).trim(),
        keys: {},
      };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf("=");
    if (!current || eq < 0) continue;
    current.keys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

/** Each kind's presets with their inheritance applied, by name. */
function resolveAll(sections) {
  const byKind = new Map();
  for (const s of sections) {
    if (!byKind.has(s.kind)) byKind.set(s.kind, new Map());
    byKind.get(s.kind).set(s.name, s.keys);
  }
  const out = new Map();
  for (const [kind, items] of byKind) {
    const cache = new Map();
    const resolve = (name, seen = new Set()) => {
      if (cache.has(name)) return cache.get(name);
      const own = items.get(name);
      if (!own) return null;
      const merged = {};
      for (const parent of (own.inherits ?? "")
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean)) {
        if (seen.has(parent)) continue;
        Object.assign(merged, resolve(parent, new Set(seen).add(name)) ?? {});
      }
      for (const [k, v] of Object.entries(own)) if (k !== "inherits") merged[k] = v;
      cache.set(name, merged);
      return merged;
    };
    out.set(kind, new Map([...items.keys()].map((name) => [name, resolve(name)])));
  }
  return out;
}

const isAbstract = (name) => name.startsWith("*") && name.endsWith("*");
const numbers = (s) =>
  String(s ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n));
const unquote = (s) => {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s;
  try {
    return JSON.parse(s);
  } catch {
    return s.slice(1, -1);
  }
};
/** `"a"; "b"` (or a bare `a`) as its names. */
const quotedList = (s) => {
  const quoted = [...String(s ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return quoted.length ? quoted : String(s ?? "").trim() ? [String(s).trim()] : [];
};

export function readPrusaProfiles(sourceDir) {
  const profiles = path.join(sourceDir, "resources", "profiles");
  const result = { vendors: [], problems: [] };
  for (const bundle of readdirSync(profiles)
    .filter((f) => f.endsWith(".ini"))
    .sort()) {
    const vendorDir = bundle.slice(0, -4);
    const sections = parseIni(readFileSync(path.join(profiles, bundle), "utf8"));
    const vendor = sections.find((s) => s.kind === "vendor")?.keys ?? {};
    const resolved = resolveAll(sections);

    const models = new Map();
    for (const s of sections) {
      if (s.kind !== "printer_model" || (s.keys.technology ?? "FFF") !== "FFF") continue;
      const cover = path.join(profiles, vendorDir, `${s.name}_thumbnail.png`);
      models.set(s.name, {
        name: (s.keys.name ?? s.name).replace(/&&/g, "&"),
        modelId: s.name,
        family: s.keys.family ?? null,
        cover: existsSync(cover) ? cover : null,
        variants: [],
      });
    }

    const prints = [...(resolved.get("print") ?? new Map())].filter(([name]) => !isAbstract(name));
    const conditions = new Map();
    for (const [name, keys] of prints) {
      const src = unquote(keys.compatible_printers_condition?.trim() ?? "");
      if (!src) continue;
      try {
        conditions.set(name, new Condition(src));
      } catch (err) {
        result.problems.push(`${bundle}: condition of ${name} not read: ${err.message}`);
      }
    }

    for (const [name, keys] of resolved.get("printer") ?? new Map()) {
      if (isAbstract(name)) continue;
      const get = (k) => (keys[k] == null || keys[k] === "" ? DEFAULTS[k] : keys[k]);
      if (get("printer_technology") !== "FFF") continue;
      const model = models.get(keys.printer_model);
      if (!model) continue;
      const nozzles = numbers(get("nozzle_diameter"));
      const highFlow = String(keys.nozzle_high_flow ?? "")
        .split(",")
        .filter((x) => x.trim())
        .map((x) => ["1", "true"].includes(x.trim()));
      const notes = unquote(keys.printer_notes ?? "");
      const env = {
        printer_notes: notes,
        printer_model: keys.printer_model ?? "",
        nozzle_diameter: nozzles.length ? nozzles : [0.4],
        nozzle_high_flow: highFlow.length ? highFlow : Array(Math.max(1, nozzles.length)).fill(false),
        num_extruders: Math.max(1, nozzles.length),
        single_extruder_multi_material: ["1", "true"].includes(get("single_extruder_multi_material")),
        printer_variant: keys.printer_variant ?? "",
        printer_technology: "FFF",
      };
      const fits = [];
      for (const [printName, printKeys] of prints) {
        const listed = (printKeys.compatible_printers ?? "")
          .split(/;|"\s+"/)
          .map((x) => x.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
        if (listed.length) {
          if (listed.includes(name)) fits.push(printName);
          continue;
        }
        const condition = conditions.get(printName);
        if (!condition) {
          if (!printKeys.compatible_printers_condition?.trim()) fits.push(printName);
          continue;
        }
        try {
          if (condition.test(env)) fits.push(printName);
        } catch {
          // An unknown variable: not taken as compatible.
        }
      }
      model.variants.push({
        preset: name,
        nozzle: keys.printer_variant || nozzleName(nozzles[0]),
        extruders: nozzles.length || 1,
        bed: bedGeometry(parsePoints(get("bed_shape"))),
        exclude: null,
        extruderBeds: null,
        height: Number(get("max_print_height")) || null,
        gcodeFlavor: get("gcode_flavor"),
        relativeE: ["1", "true"].includes(get("use_relative_e_distances")),
        structure: null,
        defaultProcess: keys.default_print_profile || null,
        processes: fits
          .map((p) => ({
            name: p,
            layerHeight: Number(resolved.get("print").get(p).layer_height) || null,
          }))
          .sort((a, b) => (a.layerHeight ?? 0) - (b.layerHeight ?? 0) || a.name.localeCompare(b.name)),
        multiMaterial:
          env.single_extruder_multi_material && nozzles.length > 1 ? ["single-extruder multi-material"] : [],
        renamedFrom: quotedList(keys.renamed_from),
      });
    }

    result.vendors.push({
      dir: vendorDir,
      name: vendor.name ?? vendorDir,
      version: vendor.config_version ?? null,
      models: [...models.values()].filter((m) => m.variants.length),
    });
  }
  return { ...result, devices: {} };
}
