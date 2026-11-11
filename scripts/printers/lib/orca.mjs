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

export function readOrcaProfiles(sourceDir, source) {
  const profiles = existsSync(path.join(sourceDir, "resources", "profiles"))
    ? path.join(sourceDir, "resources", "profiles")
    : sourceDir;
  const result = { vendors: [], problems: [] };

  for (const bundle of readdirSync(profiles)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
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
      const fits = processes.filter((p) => {
        if (p.printers.has(name)) return true;
        if (!p.condition) return false;
        try {
          return p.condition.test(env);
        } catch {
          return false;
        }
      });
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
