// The printers of an OrcaSlicer-format profile tree (OrcaSlicer, Bambu Studio and the slicers built on them):
// resources/profiles/<Vendor>.json lists the vendor's printer models; <Vendor>/machine and <Vendor>/process hold the
// presets, each `inherits`-ing keys from a parent in the same vendor. Each printer model comes out with its nozzle
// variants (instantiated machine presets) and the process presets each variant can use.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Condition } from "./condition.mjs";
import { bedGeometry, nozzleName, parsePoints } from "./geometry.mjs";

// Template printers, not real ones.
const SKIP_VENDORS = new Set(["Custom", "OrcaArena"]);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
const first = (v) => (Array.isArray(v) ? v[0] : v);
const toNumber = (v) => {
  const n = Number(first(v));
  return v == null || first(v) === "" || !Number.isFinite(n) ? null : n;
};
const toBool = (v) => (first(v) == null ? null : ["1", "true"].includes(String(first(v)).trim().toLowerCase()));
const asList = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.includes(";")) return v.split(";").filter(Boolean);
  return [v];
};

function* jsonFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(full);
    else if (entry.name.endsWith(".json")) yield full;
  }
}

/** Bambu Studio's and QIDI Studio's device files (resources/printers): model codes, limits and the like by model id. */
export function readDevices(dir) {
  const out = {};
  if (!dir || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.includes("blacklist") || name.includes("filament")) continue;
    let json;
    try {
      json = readJson(path.join(dir, name));
    } catch {
      continue;
    }
    const v = json["00.00.00.00"] ?? json;
    const print = v.print ?? {};
    const info = {
      modelId: v.model_id,
      printerType: v.printer_type,
      displayName: v.display_name,
      snPrefix: v.sn_prefix,
      subseries: v.subseries,
      arch: v.printer_arch,
      series: v.printer_series,
      enclosed: v.printer_is_enclosed,
      amsType: v.use_ams_type,
      nozzleTempMax: print.nozzle_temp_range?.[1],
      bedTempMax: print.bed_temp_range?.[1],
      chamberTempMax: print.support_chamber_temp_edit ? print.support_chamber_temp_edit_range?.[1] : undefined,
      nozzleCount: print.default_nozzle_count,
    };
    out[v.model_id ?? name.slice(0, -5)] = Object.fromEntries(
      Object.entries(info).filter(([, x]) => x != null && x !== "" && !(Array.isArray(x) && !x.length)),
    );
  }
  return out;
}

// The vendor whose filaments OrcaSlicer 2.3+ and its forks install for every printer, and whose bases other vendors'
// filaments may inherit from.
const LIBRARY = "OrcaFilamentLibrary";

/**
 * Every vendor's instantiated filament presets: name, type and the printer presets it goes with (a list or a
 * condition; neither means every printer, as the library's do).
 */
function readFilaments(profiles, bundles, problems) {
  const byVendor = new Map();
  for (const bundle of bundles) {
    const dir = bundle.slice(0, -5);
    const presets = new Map();
    for (const file of jsonFiles(path.join(profiles, dir, "filament"))) {
      try {
        const json = readJson(file);
        if (json && typeof json === "object" && json.name) presets.set(json.name, json);
      } catch (err) {
        problems.push(`${path.relative(profiles, file)}: ${err.message}`);
      }
    }
    if (presets.size) byVendor.set(dir, presets);
  }
  const library = byVendor.get(LIBRARY) ?? new Map();
  const out = [];
  for (const [dir, presets] of byVendor) {
    const resolved = new Map();
    const resolve = (name, seen) => {
      if (resolved.has(name)) return resolved.get(name);
      const own = presets.get(name) ?? library.get(name);
      if (!own || seen.has(name)) return null;
      const base = own.inherits ? (resolve(own.inherits, new Set(seen).add(name)) ?? {}) : {};
      const merged = { ...base, ...own };
      resolved.set(name, merged);
      return merged;
    };
    for (const [name, own] of presets) {
      if (String(own.instantiation ?? "true").toLowerCase() !== "true") continue;
      const r = resolve(name, new Set());
      if (!r) continue;
      const type = String(first(r.filament_type) ?? "").trim();
      if (!type) continue;
      const printers = asList(r.compatible_printers);
      let condition = null;
      if (!printers.length && r.compatible_printers_condition) {
        try {
          condition = new Condition(String(first(r.compatible_printers_condition)));
        } catch (err) {
          problems.push(`${dir}: condition of filament ${name} not read: ${err.message}`);
          continue;
        }
      }
      out.push({
        name,
        type,
        printers: new Set(printers),
        condition,
        universal: !printers.length && !condition,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The product a filament preset is for: its name without the printer it's tuned for ("Bambu PLA Basic @BBL A1M",
 * "Anker Generic PLA 0.2 nozzle"), lower case. Slicers give one product different ids (Bambu Studio's GFA00 is
 * OrcaSlicer's OFoiVqVM) but the same name. backend/src/adapter/filaments.ts reads names the same way.
 */
export function filamentProduct(name) {
  return String(name)
    .replace(/\s+@.*$/, "")
    .replace(/\s+\d+(?:\.\d+)?\s*(?:mm\s*)?nozzle$/i, "")
    .trim()
    .toLowerCase();
}

/** The pick among filaments for one printer: a filament type's generic preset where there is one, else the shortest
 *  name; a product its shortest name. */
function better(a, b) {
  const generic = (f) => (/\bgeneric\b/i.test(f.name) ? 0 : 1);
  return generic(a) - generic(b) || a.name.length - b.name.length || a.name.localeCompare(b.name);
}

/** The filaments to name for a printer, by type ("PLA") and by product ("bambu pla basic"). */
export function filamentChoices(filaments) {
  const types = new Map();
  const products = new Map();
  for (const f of filaments) {
    const t = types.get(f.type);
    if (!t || better(f, t) < 0) types.set(f.type, f);
    const key = filamentProduct(f.name);
    const p = products.get(key);
    if (key && (!p || better(f, p) < 0)) products.set(key, f);
  }
  const named = (map) =>
    Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, f]) => [k, f.name]));
  return { types: named(types), products: named(products) };
}

export function readOrcaProfiles(sourceDir, source) {
  const profiles = existsSync(path.join(sourceDir, "resources", "profiles"))
    ? path.join(sourceDir, "resources", "profiles")
    : sourceDir;
  const result = { vendors: [], problems: [] };
  const bundles = readdirSync(profiles)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const filaments = readFilaments(profiles, bundles, result.problems);
  const universal = filaments.filter((f) => f.universal);
  const listed = filaments.filter((f) => !f.universal);
  result.filaments = filamentChoices(universal);

  for (const bundle of bundles) {
    const vendorDir = bundle.slice(0, -5);
    if (SKIP_VENDORS.has(vendorDir)) continue;
    const vendorPath = path.join(profiles, vendorDir);
    let vendor;
    try {
      vendor = readJson(path.join(profiles, bundle));
    } catch (err) {
      result.problems.push(`${bundle}: ${err.message}`);
      continue;
    }
    if (!vendor || typeof vendor !== "object" || !vendor.machine_model_list?.length) continue;
    if (!existsSync(path.join(vendorPath, "machine"))) {
      result.problems.push(`${vendorDir}: no machine folder`);
      continue;
    }

    const presets = { machine: new Map(), process: new Map() };
    for (const kind of ["machine", "process"]) {
      for (const file of jsonFiles(path.join(vendorPath, kind))) {
        let json;
        try {
          json = readJson(file);
        } catch (err) {
          result.problems.push(`${path.relative(profiles, file)}: ${err.message}`);
          continue;
        }
        if (!json || typeof json !== "object" || !json.name || json.type === "machine_model") continue;
        presets[kind].set(json.name, json);
      }
    }

    const resolved = { machine: new Map(), process: new Map() };
    const resolve = (kind, name, seen = new Set()) => {
      if (resolved[kind].has(name)) return resolved[kind].get(name);
      const own = presets[kind].get(name);
      if (!own) return null;
      let base = {};
      const parent = own.inherits;
      if (parent) {
        if (seen.has(parent)) result.problems.push(`${vendorDir}: inheritance loop at ${name}`);
        else {
          const inherited = resolve(kind, parent, new Set(seen).add(name));
          if (inherited) base = { ...inherited };
          else result.problems.push(`${vendorDir}: ${name} inherits missing ${parent}`);
        }
      }
      const merged = { ...base };
      for (const [k, v] of Object.entries(own)) if (k !== "inherits" && k !== "instantiation") merged[k] = v;
      merged.instantiation = own.instantiation;
      resolved[kind].set(name, merged);
      return merged;
    };

    const models = new Map();
    for (const entry of vendor.machine_model_list) {
      const file = path.join(vendorPath, entry.sub_path ?? "");
      if (!entry.sub_path || !existsSync(file)) {
        result.problems.push(`${vendorDir}: missing model file ${entry.sub_path}`);
        continue;
      }
      const model = readJson(file);
      const cover = path.join(vendorPath, `${entry.name}_cover.png`);
      models.set(entry.name, {
        name: entry.name,
        modelId: model.model_id ?? null,
        family: model.family ?? null,
        cover: existsSync(cover) ? cover : null,
        variants: [],
      });
    }

    const processes = [];
    for (const [name, own] of presets.process) {
      if (String(own.instantiation ?? "true").toLowerCase() !== "true") continue;
      const r = resolve("process", name);
      let condition = null;
      const src = r.compatible_printers_condition;
      if (src && !asList(r.compatible_printers).length) {
        try {
          condition = new Condition(String(src));
        } catch (err) {
          result.problems.push(`${vendorDir}: condition of ${name} not read: ${err.message}`);
        }
      }
      processes.push({
        name,
        printers: new Set(asList(r.compatible_printers)),
        condition,
        layerHeight: toNumber(r.layer_height),
      });
    }

    for (const [name, own] of presets.machine) {
      if (own.type !== "machine" || String(own.instantiation ?? "").toLowerCase() !== "true") continue;
      const r = resolve("machine", name);
      const model = models.get(r.printer_model);
      if (!model) {
        result.problems.push(
          `${vendorDir}: ${name} names printer model ${JSON.stringify(r.printer_model)}, not listed`,
        );
        continue;
      }
      const nozzles = asList(r.nozzle_diameter)
        .flatMap((x) => String(x).split(","))
        .map((x) => x.trim())
        .filter(Boolean);
      let exclude = parsePoints(r.bed_exclude_area);
      if (exclude.every(([x, y]) => x === 0 && y === 0)) exclude = [];
      const env = {
        printer_notes: String(first(r.printer_notes) ?? ""),
        printer_model: r.printer_model ?? "",
        nozzle_diameter: nozzles.length ? nozzles.map(Number) : [0.4],
        num_extruders: Math.max(1, nozzles.length),
        printer_variant: String(r.printer_variant ?? ""),
        printer_technology: "FFF",
      };
      const extruderBeds = asList(r.extruder_printable_area)
        .map((a) => bedGeometry(parsePoints(a)))
        .filter(Boolean);
      const goesWith = (p) => {
        if (p.printers.has(name)) return true;
        if (!p.condition) return false;
        try {
          return p.condition.test(env);
        } catch {
          return false;
        }
      };
      const fits = processes.filter(goesWith);
      model.variants.push({
        preset: name,
        nozzle: nozzleName(r.printer_variant ?? nozzles[0]),
        extruders: nozzles.length || 1,
        bed: bedGeometry(parsePoints(r.printable_area)),
        exclude: exclude.length ? exclude : null,
        extruderBeds: extruderBeds.length ? extruderBeds : null,
        height: toNumber(r.printable_height),
        gcodeFlavor: first(r.gcode_flavor) ?? null,
        relativeE: toBool(r.use_relative_e_distances),
        structure: first(r.printer_structure) ?? null,
        defaultProcess: first(r.default_print_profile) ?? null,
        processes: fits
          .map((p) => ({ name: p.name, layerHeight: p.layerHeight }))
          .sort((a, b) => (a.layerHeight ?? 0) - (b.layerHeight ?? 0) || a.name.localeCompare(b.name)),
        defaultFilament: first(r.default_filament_profile) ?? null,
        filaments: filamentChoices(listed.filter(goesWith)),
        multiMaterial: [
          String(r.is_support_multi_box) === "1" && "QIDI Box",
          String(r.support_multi_filament) === "1" && "multi-filament unit",
          r.default_ams_type && `AMS (${r.default_ams_type})`,
        ].filter(Boolean),
      });
    }

    result.vendors.push({
      dir: vendorDir,
      name: vendor.name ?? vendorDir,
      version: vendor.version ?? null,
      models: [...models.values()].filter((m) => m.variants.length),
    });
  }

  const devices = source.devices ? readDevices(path.join(sourceDir, source.devices)) : {};
  return { ...result, devices };
}
