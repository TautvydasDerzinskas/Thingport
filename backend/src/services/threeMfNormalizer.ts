import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { decodePaintState, encodePaintState, stateToMaterialIndex } from "./threeMfColors";

// Flattens a Bambu/Orca production-extension 3MF into core 3MF that PrusaSlicer, Cura and Anycubic
// import correctly, keeping painted colors, filament colors and the designer's process settings.
// Everything is regex-based on purpose: model files can be hundreds of MB, too big for a DOM parser.

type Settings = Record<string, unknown>;

const CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const THUMB_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";
const IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0";
const NO_MODEL = "No valid 3D model found inside the 3MF file.";

export const BAMBU_TO_SLIC3R: Record<string, string> = {
  layer_height: "layer_height",
  initial_layer_print_height: "first_layer_height",
  wall_loops: "perimeters",
  top_shell_layers: "top_solid_layers",
  bottom_shell_layers: "bottom_solid_layers",
  top_shell_thickness: "top_solid_min_thickness",
  bottom_shell_thickness: "bottom_solid_min_thickness",
  sparse_infill_density: "fill_density",
  sparse_infill_pattern: "fill_pattern",
  line_width: "extrusion_width",
  outer_wall_line_width: "external_perimeter_extrusion_width",
  inner_wall_line_width: "perimeter_extrusion_width",
  initial_layer_line_width: "first_layer_extrusion_width",
  sparse_infill_line_width: "infill_extrusion_width",
  internal_solid_infill_line_width: "solid_infill_extrusion_width",
  top_surface_line_width: "top_infill_extrusion_width",
  support_line_width: "support_material_extrusion_width",
  enable_support: "support_material",
  support_threshold_angle: "support_material_threshold",
  support_on_build_plate_only: "support_material_buildplate_only",
  support_object_xy_distance: "support_material_xy_spacing",
  support_top_z_distance: "support_material_contact_distance",
  raft_layers: "raft_layers",
  brim_width: "brim_width",
  brim_type: "brim_type",
  skirt_loops: "skirts",
  skirt_distance: "skirt_distance",
  skirt_height: "skirt_height",
  detect_thin_wall: "thin_walls",
  wall_generator: "perimeter_generator",
  infill_wall_overlap: "infill_overlap",
  infill_direction: "fill_angle",
  ironing_type: "ironing",
  ironing_flow: "ironing_flowrate",
  ironing_spacing: "ironing_spacing",
  filament_colour: "filament_colour",
  filament_type: "filament_type",
  filament_diameter: "filament_diameter",
  filament_density: "filament_density",
  filament_flow_ratio: "extrusion_multiplier",
  filament_max_volumetric_speed: "filament_max_volumetric_speed",
  nozzle_temperature: "temperature",
  nozzle_temperature_initial_layer: "first_layer_temperature",
  hot_plate_temp: "bed_temperature",
  hot_plate_temp_initial_layer: "first_layer_bed_temperature",
  fan_max_speed: "max_fan_speed",
  fan_min_speed: "min_fan_speed",
  retraction_length: "retract_length",
  retraction_speed: "retract_speed",
  elefant_foot_compensation: "elefant_foot_compensation",
  resolution: "resolution",
  spiral_mode: "spiral_vase",
  ensure_vertical_shell_thickness: "ensure_vertical_shell_thickness",
  top_surface_pattern: "top_fill_pattern",
  bottom_surface_pattern: "bottom_fill_pattern",
  support_interface_pattern: "support_material_interface_pattern",
  support_base_pattern: "support_material_pattern",
  support_interface_top_layers: "support_material_interface_layers",
  tree_support_branch_angle: "support_tree_angle",
  tree_support_branch_diameter: "support_tree_branch_diameter",
  tree_support_branch_distance: "support_tree_branch_distance",
};

const PATTERN_MAP: Record<string, string> = {
  crosshatch: "grid",
  "zig-zag": "zigzag",
  zigzag: "zigzag",
};

// Printer/machine profile keys: they'd drag the designer's Bambu printer into the other slicer.
const STRIP_SETTING_KEYS = new Set([
  "printer_model",
  "printer_settings_id",
  "printer_variant",
  "printer_notes",
  "printer_structure",
  "printer_technology",
  "printer_extruder_id",
  "printer_extruder_variant",
  "print_compatible_printers",
  "upward_compatible_machine",
  "printable_area",
  "printable_height",
  "bed_exclude_area",
  "bed_custom_model",
  "bed_custom_texture",
  "gcode_flavor",
  "host_type",
  "printhost_authorization_type",
  "printhost_ssl_ignore_revoke",
  "scan_first_layer",
  "silent_mode",
  "thumbnail_size",
  "default_print_profile",
  "default_filament_profile",
  "print_settings_id",
  "from",
  "filename_format",
  "extruder_printable_area",
  "extruder_printable_height",
  "head_wrap_detect_zone",
  "wrapping_exclude_area",
  "nozzle_type",
  "nozzle_volume",
  "nozzle_volume_type",
  "nozzle_height",
  "auxiliary_fan",
  "extruder_ams_count",
  "extruder_type",
  "extruder_variant_list",
  "extruder_max_nozzle_count",
  "extruder_nozzle_stats",
  "extruder_offset",
  "extruder_clearance_dist_to_rod",
  "extruder_clearance_height_to_lid",
  "extruder_clearance_height_to_rod",
  "extruder_clearance_max_radius",
  "physical_extruder_map",
  "print_extruder_id",
  "print_extruder_variant",
  "master_extruder_id",
  "has_filament_switcher",
  "default_nozzle_volume_type",
  "machine_bed_mass_Y",
  "machine_hotend_change_time",
  "machine_load_filament_time",
  "machine_max_printed_mass",
  "machine_max_force_Y",
  "machine_prepare_compensation_time",
  "machine_switch_extruder_time",
  "machine_unload_filament_time",
  "template_custom_gcode",
  "post_process",
  "curr_bed_type",
  "filament_settings_id",
  "filament_ids",
  "filament_extruder_compatibility",
  "filament_extruder_variant",
  "filament_map",
  "filament_map_mode",
  "filament_volume_map",
  "filament_nozzle_map",
  "use_relative_e_distances",
  "use_firmware_retraction",
  "use_volumetric_e",
  "default_ams_type",
]);

const FILAMENT_SLOT_KEYS = new Set([
  "wall_filament",
  "solid_infill_filament",
  "sparse_infill_filament",
  "support_filament",
  "support_interface_filament",
]);

const VERTICAL_SHELL_MAP: Record<string, string> = {
  enabled: "ensure_all",
  "1": "ensure_all",
  true: "ensure_all",
  disabled: "disabled",
  "0": "disabled",
  false: "disabled",
  none: "disabled",
  partial: "ensure_moderate",
};

const FILAMENT_ARRAY_KEYS = new Set([
  "filament_colour",
  "filament_type",
  "filament_diameter",
  "filament_density",
  "filament_flow_ratio",
  "filament_max_volumetric_speed",
  "nozzle_temperature",
  "nozzle_temperature_initial_layer",
  "hot_plate_temp",
  "hot_plate_temp_initial_layer",
  "fan_max_speed",
  "fan_min_speed",
  "retraction_length",
  "retraction_speed",
]);

const BOOLEAN_KEYS = new Set(["enable_support", "detect_thin_wall", "spiral_mode", "support_on_build_plate_only"]);

const KEEP_META_NAMES = new Set([
  "Title",
  "Description",
  "Designer",
  "Copyright",
  "License",
  "CreationDate",
  "ModificationDate",
]);

function normalizePath(p: string | null | undefined): string {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function pathKey(p: string): string {
  return normalizePath(p).toLowerCase();
}

function escapeXml(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseAttrs(attrStr: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr || ""))) attrs[m[1]] = m[2];
  return attrs;
}

function readMetadata(xml: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const re = /<metadata\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    if (attrs.key) meta[attrs.key] = attrs.value;
  }
  return meta;
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function slic3rSerialize(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(";");
  if (value === true) return "1";
  if (value === false) return "0";
  return String(value);
}

function mapFillPattern(pattern: unknown): unknown {
  if (pattern == null) return pattern;
  return PATTERN_MAP[String(pattern).toLowerCase()] || pattern;
}

export function shouldStripSettingKey(key: string): boolean {
  if (STRIP_SETTING_KEYS.has(key)) return true;
  if (key.startsWith("machine_max_") || key.startsWith("machine_min_")) return true;
  if (key.endsWith("_gcode")) return true;
  return key.startsWith("printhost_");
}

// "nil" and -1 mean "inherit from the profile" in Bambu; other slicers read them literally.
function isSentinelSettingToken(value: unknown): boolean {
  if (value == null) return true;
  const s = String(value).trim().toLowerCase();
  return s === "nil" || s === "-1";
}

function normalizeSettingValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (!value.length || value.some(isSentinelSettingToken)) return undefined;
    return value;
  }
  return isSentinelSettingToken(value) ? undefined : value;
}

function isUnsetFilamentSlot(key: string, value: unknown): boolean {
  if (!FILAMENT_SLOT_KEYS.has(key)) return false;
  const n = Number(firstValue(value));
  return !Number.isFinite(n) || n < 1;
}

function mapVerticalShellThickness(value: unknown): unknown {
  const raw = String(firstValue(value)).trim().toLowerCase();
  return VERTICAL_SHELL_MAP[raw] || firstValue(value);
}

export function extractBambuSettings(config: unknown): Settings {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const settings = config as Settings;
  const processSettings = settings.process_settings as Record<string, unknown> | undefined;
  if (processSettings && typeof processSettings === "object") {
    const nested = processSettings["1"];
    if (nested && typeof nested === "object") return { ...settings, ...(nested as Settings) };
  }
  return settings;
}

function syncExtruderColours(out: Settings): void {
  const filaments = asArray(out.filament_colour);
  const extruders = asArray(out.extruder_colour);
  if (filaments.length && filaments.length > extruders.length) out.extruder_colour = filaments;
}

export function mapSettingsToSlic3r(bambuSettings: Settings): Settings {
  const out: Settings = {};
  for (const [bambuKey, slic3rKey] of Object.entries(BAMBU_TO_SLIC3R)) {
    let value = bambuSettings[bambuKey];
    if (value == null || value === "") continue;

    if (bambuKey === "sparse_infill_pattern") value = mapFillPattern(firstValue(value));
    if (BOOLEAN_KEYS.has(bambuKey)) {
      const raw = firstValue(value);
      value = raw === true || raw === "1" || raw === 1 || String(raw).toLowerCase() === "true" ? "1" : "0";
    }
    if (bambuKey === "ironing_type") {
      const raw = String(firstValue(value)).toLowerCase();
      value = raw && raw !== "no ironing" && raw !== "none" ? "1" : "0";
    }
    if (bambuKey === "wall_generator") {
      value = String(firstValue(value)).toLowerCase() === "arachne" ? "arachne" : "classic";
    }
    if (bambuKey === "ensure_vertical_shell_thickness") value = mapVerticalShellThickness(value);
    if (FILAMENT_ARRAY_KEYS.has(bambuKey)) value = asArray(value);
    else if (Array.isArray(value)) value = firstValue(value);

    out[slic3rKey] = value;
  }
  syncExtruderColours(out);
  return out;
}

export function normalizeProjectSettings(config: Settings): Settings {
  const out: Settings = {};
  for (const [key, value] of Object.entries(extractBambuSettings(config))) {
    if (shouldStripSettingKey(key) || isUnsetFilamentSlot(key, value)) continue;
    const cleaned = normalizeSettingValue(value);
    if (cleaned === undefined) continue;
    out[key] = key === "ensure_vertical_shell_thickness" ? mapVerticalShellThickness(cleaned) : cleaned;
  }
  syncExtruderColours(out);
  return out;
}

function buildSlic3rConfig(mapped: Settings): string {
  const lines = ["; generated by Thingport", ""];
  for (const key of Object.keys(mapped).toSorted()) lines.push(`; ${key} = ${slic3rSerialize(mapped[key])}`);
  return lines.join("\n") + "\n";
}

type PartSettings = { id?: string; name: string; extruder: number };
type ObjectSettings = { id: string; name: string; extruder: number; parts: PartSettings[] };

function parseModelSettings(xml: string): Record<string, ObjectSettings> {
  const objects: Record<string, ObjectSettings> = {};
  const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let m;
  while ((m = objectRe.exec(xml))) {
    const id = parseAttrs(m[1]).id;
    if (!id) continue;
    const body = m[2];
    const partAt = body.search(/<part\b/i);
    const meta = readMetadata(partAt >= 0 ? body.slice(0, partAt) : body);
    const objectExtruder = meta.extruder ? Number.parseInt(meta.extruder, 10) : 1;
    const parts: PartSettings[] = [];
    const partRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/gi;
    let p;
    while ((p = partRe.exec(body))) {
      const partMeta = readMetadata(p[2]);
      parts.push({
        id: parseAttrs(p[1]).id,
        name: partMeta.name || "",
        extruder: partMeta.extruder ? Number.parseInt(partMeta.extruder, 10) : objectExtruder,
      });
    }
    objects[id] = { id, name: meta.name || "", extruder: objectExtruder, parts };
  }
  return objects;
}

type PlateInstance = { objectId: string; instanceId: number; identifyId: string };
type PlateSettings = { id: string; name: string; instances: PlateInstance[] };

export function parsePlates(xml: string): PlateSettings[] {
  const plates: PlateSettings[] = [];
  const plateRe = /<plate>([\s\S]*?)<\/plate>/gi;
  let m;
  while ((m = plateRe.exec(xml))) {
    const body = m[1];
    const instAt = body.search(/<model_instance/i);
    const meta = readMetadata(instAt >= 0 ? body.slice(0, instAt) : body);
    const instances: PlateInstance[] = [];
    const instRe = /<model_instance>([\s\S]*?)<\/model_instance>/gi;
    let im;
    while ((im = instRe.exec(body))) {
      const imeta = readMetadata(im[1]);
      if (!imeta.object_id) continue;
      instances.push({
        objectId: String(imeta.object_id),
        instanceId: imeta.instance_id != null ? Number.parseInt(imeta.instance_id, 10) || 0 : 0,
        identifyId: imeta.identify_id || "",
      });
    }
    plates.push({ id: meta.plater_id || String(plates.length + 1), name: meta.plater_name || "", instances });
  }
  return plates;
}

type OutBuildItem = {
  objectid: number;
  transform: string | null;
  printable: string;
  sourceObjectId: string;
  sourceInstanceId: number;
  outInstanceId?: number;
};

function assignInstancesToPlates(sourcePlates: PlateSettings[], emitted: OutBuildItem[]): PlateSettings[] {
  const remaining = emitted.slice();
  const take = (sourceObjectId: string, sourceInstanceId: number) => {
    const idx = remaining.findIndex(
      (item) => item.sourceObjectId === String(sourceObjectId) && item.sourceInstanceId === sourceInstanceId,
    );
    return idx < 0 ? null : remaining.splice(idx, 1)[0];
  };

  let identify = 1;
  const plates: PlateSettings[] = [];
  for (const plate of sourcePlates) {
    const instances: PlateInstance[] = [];
    for (const inst of plate.instances) {
      const hit = take(inst.objectId, inst.instanceId);
      if (!hit) continue;
      instances.push({
        objectId: String(hit.objectid),
        instanceId: hit.outInstanceId ?? 0,
        identifyId: inst.identifyId || String(identify++),
      });
    }
    if (instances.length) plates.push({ id: String(plates.length + 1), name: plate.name || "", instances });
  }

  if (!plates.length && remaining.length) plates.push({ id: "1", name: "", instances: [] });
  if (remaining.length) {
    const last = plates[plates.length - 1];
    for (const item of remaining) {
      last.instances.push({
        objectId: String(item.objectid),
        instanceId: item.outInstanceId ?? 0,
        identifyId: String(identify++),
      });
    }
  }
  return plates;
}

type ModelMetadata = { attrs: Record<string, string>; text: string };

// Tolerates unclosed <metadata> tags, which MakerWorld exports emit for an empty Copyright.
function extractModelMetadata(xml: string): ModelMetadata[] {
  const metas: ModelMetadata[] = [];
  const modelOpen = xml.match(/<model\b[^>]*>/i);
  if (!modelOpen) return metas;
  const after = xml.slice(xml.indexOf(modelOpen[0]) + modelOpen[0].length);
  const resourcesAt = after.search(/<resources[\s>]/i);
  const head = resourcesAt >= 0 ? after.slice(0, resourcesAt) : after;
  const startRe = /<metadata\b/gi;
  let start;
  while ((start = startRe.exec(head))) {
    const afterName = start.index + start[0].length;
    const rest = head.slice(afterName);
    const endAttrs = rest.search(/\/?>/);
    if (endAttrs < 0) break;
    const selfClose = rest[endAttrs] === "/";
    let cursor = afterName + endAttrs + (selfClose ? 2 : 1);
    let text = "";
    if (!selfClose) {
      const tail = head.slice(cursor);
      const closeAt = tail.search(/<\/metadata>/i);
      const nextMeta = tail.search(/<metadata\b/i);
      if (closeAt >= 0 && (nextMeta < 0 || closeAt < nextMeta)) {
        text = tail.slice(0, closeAt);
        cursor += closeAt + "</metadata>".length;
      }
    }
    startRe.lastIndex = cursor;
    metas.push({ attrs: parseAttrs(rest.slice(0, endAttrs)), text });
  }
  return metas;
}

function formatCoreMetadata(name: string, text: string): string {
  const value = text.trim();
  if (!value) return ` <metadata name="${escapeXml(name)}" />`;
  return ` <metadata name="${escapeXml(name)}">${escapeXml(value)}</metadata>`;
}

type Component = { objectid: string; path: string | null; transform: string | null };
type ModelObject = { id: string; body: string; hasMesh: boolean; components: Component[] };
type SourceBuildItem = { objectid: string; transform: string | null; printable?: string; instanceId: number };

function extractComponents(body: string): Component[] {
  const comps: Component[] = [];
  const re = /<component\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(body))) {
    const attrs = parseAttrs(m[1]);
    comps.push({
      objectid: attrs.objectid,
      path: attrs["p:path"] || attrs.path || null,
      transform: attrs.transform || null,
    });
  }
  return comps;
}

function extractObjects(xml: string): ModelObject[] {
  const objects: ModelObject[] = [];
  const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[2];
    objects.push({
      id: parseAttrs(m[1]).id,
      body,
      hasMesh: /<mesh[\s>]/i.test(body),
      components: extractComponents(body),
    });
  }
  return objects;
}

function extractBuildItems(xml: string): SourceBuildItem[] {
  const items: SourceBuildItem[] = [];
  const instanceCount: Record<string, number> = {};
  const re = /<item\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    if (!attrs.objectid) continue;
    const n = instanceCount[attrs.objectid] || 0;
    instanceCount[attrs.objectid] = n + 1;
    items.push({
      objectid: attrs.objectid,
      transform: attrs.transform || null,
      printable: attrs.printable,
      instanceId: n,
    });
  }
  return items;
}

function parseTransform(str: string | null | undefined): number[] {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  if (!str) return identity;
  const n = String(str)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return n.length !== 12 || n.some((x) => Number.isNaN(x)) ? identity : n;
}

// 3MF transforms are a row-major 3x3 plus translation; composes as out = A * B.
function multiplyTransform(aStr: string | null, bStr: string | null): number[] {
  const A = parseTransform(aStr);
  const B = parseTransform(bStr);
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22, atx, aty, atz] = A;
  const [b00, b01, b02, b10, b11, b12, b20, b21, b22, btx, bty, btz] = B;
  return [
    a00 * b00 + a01 * b10 + a02 * b20,
    a00 * b01 + a01 * b11 + a02 * b21,
    a00 * b02 + a01 * b12 + a02 * b22,
    a10 * b00 + a11 * b10 + a12 * b20,
    a10 * b01 + a11 * b11 + a12 * b21,
    a10 * b02 + a11 * b12 + a12 * b22,
    a20 * b00 + a21 * b10 + a22 * b20,
    a20 * b01 + a21 * b11 + a22 * b21,
    a20 * b02 + a21 * b12 + a22 * b22,
    a00 * btx + a01 * bty + a02 * btz + atx,
    a10 * btx + a11 * bty + a12 * btz + aty,
    a20 * btx + a21 * bty + a22 * btz + atz,
  ];
}

function formatNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(Math.round(n * 1e7) / 1e7);
}

function formatTransform(m: number[]): string {
  return m.map(formatNumber).join(" ");
}

// indexOf rather than match(): a regex match on a big mesh allocates millions of strings.
function countOccurrences(xml: string, needle: string): number {
  let count = 0;
  for (let at = xml.indexOf(needle); at !== -1; at = xml.indexOf(needle, at + needle.length)) count++;
  return count;
}

function displayColor(hex: unknown): string {
  const raw = String(hex || "#808080").replace(/^#/, "");
  if (raw.length === 8) return `#${raw.toUpperCase()}`;
  if (raw.length === 6) return `#${raw.toUpperCase()}FF`;
  return "#808080FF";
}

function applyTriangleMaterials(
  body: string,
  materialsId: number,
  defaultExtruder: number,
  colorCount: number,
): string {
  return body.replace(/<triangle\b([^>]*)\/?>/gi, (_full, attrStr: string) => {
    const attrs = parseAttrs(attrStr);
    const paint = attrs.paint_color || attrs["slic3rpe:mmu_segmentation"] || "";
    const p1 = stateToMaterialIndex(paint ? decodePaintState(paint) : 0, defaultExtruder, colorCount);
    let out = `<triangle v1="${attrs.v1}" v2="${attrs.v2}" v3="${attrs.v3}" pid="${materialsId}" p1="${p1}"`;
    if (paint) out += ` paint_color="${escapeXml(paint)}" slic3rpe:mmu_segmentation="${escapeXml(paint)}"`;
    if (attrs.paint_supports) out += ` paint_supports="${escapeXml(attrs.paint_supports)}"`;
    if (attrs.paint_seam) out += ` paint_seam="${escapeXml(attrs.paint_seam)}"`;
    return `${out}/>`;
  });
}

export { decodePaintState, encodePaintState, stateToMaterialIndex };

type Volume = { name: string; extruder: number; firstid: number; lastid: number };
type ObjectMeta = { id: number; name: string; extruder: number; volumes: Volume[] };

function buildModelSettingsConfig(
  objects: ObjectMeta[],
  plates: PlateSettings[],
  assembleItems: OutBuildItem[],
): string {
  const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  for (const obj of objects) {
    chunks.push(`  <object id="${obj.id}">`);
    if (obj.name) chunks.push(`    <metadata key="name" value="${escapeXml(obj.name)}"/>`);
    chunks.push(`    <metadata key="extruder" value="${obj.extruder || 1}"/>`);
    const parts = obj.volumes.length ? obj.volumes : [{ name: obj.name, extruder: obj.extruder || 1 }];
    parts.forEach((part, index) => {
      chunks.push(`    <part id="${index + 1}" subtype="normal_part">`);
      if (part.name) chunks.push(`      <metadata key="name" value="${escapeXml(part.name)}"/>`);
      chunks.push(`      <metadata key="extruder" value="${part.extruder || obj.extruder || 1}"/>`);
      chunks.push("    </part>");
    });
    chunks.push("  </object>");
  }
  for (const plate of plates) {
    chunks.push("  <plate>");
    chunks.push(`    <metadata key="plater_id" value="${escapeXml(plate.id || "1")}"/>`);
    chunks.push(`    <metadata key="plater_name" value="${escapeXml(plate.name || "")}"/>`);
    chunks.push(`    <metadata key="locked" value="false"/>`);
    for (const inst of plate.instances) {
      chunks.push("    <model_instance>");
      chunks.push(`      <metadata key="object_id" value="${inst.objectId}"/>`);
      chunks.push(`      <metadata key="instance_id" value="${inst.instanceId}"/>`);
      chunks.push(`      <metadata key="identify_id" value="${escapeXml(inst.identifyId || "1")}"/>`);
      chunks.push("    </model_instance>");
    }
    chunks.push("  </plate>");
  }
  if (assembleItems.length) {
    chunks.push("  <assemble>");
    for (const item of assembleItems) {
      chunks.push(
        `   <assemble_item object_id="${item.objectid}" instance_id="${item.outInstanceId ?? 0}" transform="${escapeXml(item.transform || IDENTITY)}" offset="0 0 0" />`,
      );
    }
    chunks.push("  </assemble>");
  }
  chunks.push("</config>", "");
  return chunks.join("\n");
}

function buildSlic3rModelConfig(objects: ObjectMeta[]): string {
  const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  for (const obj of objects) {
    chunks.push(` <object id="${obj.id}" instancescount="1">`);
    if (obj.name) chunks.push(`  <metadata type="object" key="name" value="${escapeXml(obj.name)}"/>`);
    if (obj.extruder) chunks.push(`  <metadata type="object" key="extruder" value="${obj.extruder}"/>`);
    for (const vol of obj.volumes) {
      chunks.push(`  <volume firstid="${vol.firstid}" lastid="${vol.lastid}">`);
      if (vol.name) chunks.push(`   <metadata type="volume" key="name" value="${escapeXml(vol.name)}"/>`);
      chunks.push(`   <metadata type="volume" key="extruder" value="${vol.extruder || obj.extruder || 1}"/>`);
      chunks.push("  </volume>");
    }
    chunks.push(" </object>");
  }
  chunks.push("</config>", "");
  return chunks.join("\n");
}

/** Entries rebuilt from scratch or that only Bambu reads (sliced G-code, plate caches, split objects). */
function shouldDropEntry(relativePath: string): boolean {
  const p = pathKey(relativePath);
  if (p.includes(".gcode") || p.includes("slice_info") || p.includes("custom_gcode")) return true;
  if (p.startsWith("3d/objects/") || p.startsWith("3d/_rels/")) return true;
  if (p.startsWith("auxiliaries/") || p.startsWith("metadata/_rels/")) return true;
  if (p.includes("filament_settings") || p.includes("filament_sequence") || p.includes("cut_information")) return true;
  if (/plate_\d+\.json$/.test(p)) return true;
  if (p.endsWith("metadata/project_settings.config") || p.endsWith("metadata/model_settings.config")) return true;
  return p === "[content_types].xml" || p === "_rels/.rels" || p === "3d/3dmodel.model";
}

type ZipRecord = { relativePath: string; entry: JSZip.JSZipObject };

function indexZipFiles(zip: JSZip): Record<string, ZipRecord> {
  const filesByKey: Record<string, ZipRecord> = {};
  for (const [relativePath, entry] of Object.entries(zip.files)) {
    if (!entry.dir) filesByKey[pathKey(relativePath)] = { relativePath, entry };
  }
  return filesByKey;
}

type ParsedModel = {
  objects: ModelObject[];
  buildItems: SourceBuildItem[];
  metadata: ModelMetadata[];
};

type Resolved = {
  kind: "mesh" | "assembly";
  obj: ModelObject;
  filePath: string;
  objectId: string;
  transform: string | null;
};

function getObject(parsedModels: Record<string, ParsedModel>, filePath: string, objectId: string): ModelObject | null {
  return parsedModels[pathKey(filePath)]?.objects.find((o) => String(o.id) === String(objectId)) ?? null;
}

/** Follows single-component wrappers down to a mesh, composing their transforms on the way. */
function resolveTarget(
  parsedModels: Record<string, ParsedModel>,
  filePath: string,
  objectId: string,
  transform: string | null,
  seen: Set<string>,
): Resolved | null {
  const mark = `${pathKey(filePath)}::${objectId}`;
  if (seen.has(mark)) return null;
  seen.add(mark);
  const obj = getObject(parsedModels, filePath, objectId);
  if (!obj) return null;
  if (obj.hasMesh && obj.components.length === 0) return { kind: "mesh", obj, filePath, objectId, transform };
  if (!obj.hasMesh && obj.components.length === 1) {
    const c = obj.components[0];
    const childPath = c.path ? normalizePath(c.path) : filePath;
    return resolveTarget(
      parsedModels,
      childPath,
      c.objectid,
      formatTransform(multiplyTransform(transform, c.transform)),
      seen,
    );
  }
  return { kind: "assembly", obj, filePath, objectId, transform };
}

function buildBasematerialsXml(id: number, colors: unknown[], types: unknown[]): string {
  const palette = colors.length ? colors : ["#808080"];
  const names = colors.length ? types : ["Filament"];
  const bases = palette
    .map(
      (c, i) => `  <base name="${escapeXml(`${names[i] || "Filament"} ${i + 1}`)}" displaycolor="${displayColor(c)}"/>`,
    )
    .join("\n");
  return `<basematerials id="${id}">\n${bases}\n </basematerials>`;
}

type Part = { name: string; extruder: number; body: string; localTransform: string };
type Triangle = { v1: number; v2: number; v3: number; paint: string; p1: number | null };

function parseMeshGeometry(body: string): { vertices: number[][]; triangles: Triangle[] } {
  const vertices: number[][] = [];
  const vRe = /<vertex\b([^>]*)\/?>/gi;
  let m;
  while ((m = vRe.exec(body))) {
    const a = parseAttrs(m[1]);
    vertices.push([Number.parseFloat(a.x) || 0, Number.parseFloat(a.y) || 0, Number.parseFloat(a.z) || 0]);
  }
  const triangles: Triangle[] = [];
  const tRe = /<triangle\b([^>]*)\/?>/gi;
  while ((m = tRe.exec(body))) {
    const a = parseAttrs(m[1]);
    triangles.push({
      v1: Number.parseInt(a.v1, 10),
      v2: Number.parseInt(a.v2, 10),
      v3: Number.parseInt(a.v3, 10),
      paint: a.paint_color || "",
      p1: a.p1 != null && a.p1 !== "" ? Number.parseInt(a.p1, 10) : null,
    });
  }
  return { vertices, triangles };
}

function transformPoint(point: number[], matrix: string): number[] {
  const M = parseTransform(matrix);
  const [x, y, z] = point;
  return [
    M[0] * x + M[1] * y + M[2] * z + M[9],
    M[3] * x + M[4] * y + M[5] * z + M[10],
    M[6] * x + M[7] * y + M[8] * z + M[11],
  ];
}

/** Bakes an assembly's parts into one mesh, painting each part in its own filament so colors survive
 *  slicers that ignore per-volume extruders. */
function mergePartsToMesh(parts: Part[], materialsId: number, colors: unknown[]): { body: string; volumes: Volume[] } {
  const vertexLines: string[] = [];
  const triangleLines: string[] = [];
  const volumes: Volume[] = [];
  let vOffset = 0;
  let tOffset = 0;
  const paletteSize = colors.length || 1;

  for (const part of parts) {
    const geom = parseMeshGeometry(part.body);
    for (const vertex of geom.vertices) {
      const p = transformPoint(vertex, part.localTransform);
      vertexLines.push(`     <vertex x="${formatNumber(p[0])}" y="${formatNumber(p[1])}" z="${formatNumber(p[2])}"/>`);
    }
    const defaultIdx = stateToMaterialIndex(0, part.extruder, paletteSize);
    for (const tri of geom.triangles) {
      let idx = defaultIdx;
      if (tri.p1 !== null && Number.isInteger(tri.p1)) idx = Math.min(Math.max(tri.p1, 0), paletteSize - 1);
      else if (tri.paint) idx = stateToMaterialIndex(decodePaintState(tri.paint), part.extruder, paletteSize);
      const paint = tri.paint || encodePaintState(part.extruder);
      let extra = ` pid="${materialsId}" p1="${idx}"`;
      if (paint) extra += ` paint_color="${escapeXml(paint)}" slic3rpe:mmu_segmentation="${escapeXml(paint)}"`;
      triangleLines.push(
        `     <triangle v1="${tri.v1 + vOffset}" v2="${tri.v2 + vOffset}" v3="${tri.v3 + vOffset}"${extra}/>`,
      );
    }
    const tCount = geom.triangles.length;
    if (tCount > 0)
      volumes.push({ name: part.name, extruder: part.extruder, firstid: tOffset, lastid: tOffset + tCount - 1 });
    vOffset += geom.vertices.length;
    tOffset += tCount;
  }

  return {
    body:
      "\n   <mesh>\n    <vertices>\n" +
      vertexLines.join("\n") +
      "\n    </vertices>\n    <triangles>\n" +
      triangleLines.join("\n") +
      "\n    </triangles>\n   </mesh>\n  ",
    volumes,
  };
}

type FlattenInput = {
  parsedModels: Record<string, ParsedModel>;
  rootPath: string;
  modelSettings: Record<string, ObjectSettings>;
  bambuSettings: Settings;
  mappedSettings: Settings;
  plates: PlateSettings[];
};

type EmittedMesh = { id: number; body: string; extruder: number; merged?: boolean };

function partInfo(wrapper: Partial<ObjectSettings>, componentObjectId: string, componentIndex: number): PartSettings {
  const parts = wrapper.parts || [];
  return (
    parts.find((p) => String(p.id) === String(componentObjectId)) ||
    parts[componentIndex] || { name: wrapper.name || "", extruder: wrapper.extruder || 1 }
  );
}

function buildFlattenedModel({
  parsedModels,
  rootPath,
  modelSettings,
  bambuSettings,
  mappedSettings,
  plates,
}: FlattenInput) {
  const root = parsedModels[pathKey(rootPath)];
  if (!root) throw new Error(NO_MODEL);

  const colors = asArray(bambuSettings.filament_colour);
  const types = asArray(bambuSettings.filament_type);
  const materialsId = 1;
  let nextId = 2;

  const meshKeyToId = new Map<string, { id: number; extruder: number }>();
  const emittedMeshes: EmittedMesh[] = [];
  const buildItems: OutBuildItem[] = [];
  const objectMeta: ObjectMeta[] = [];

  // A shared mesh used with a different extruder is cloned, since the filament lives on the object.
  function ensureMesh(filePath: string, objectId: string, extruder: number): number | null {
    const key = `${pathKey(filePath)}::${objectId}`;
    const src = getObject(parsedModels, filePath, objectId);
    const existing = meshKeyToId.get(key);
    if (existing) {
      if (existing.extruder && extruder && existing.extruder !== extruder && src) {
        const cloneId = nextId++;
        emittedMeshes.push({ id: cloneId, body: src.body, extruder });
        return cloneId;
      }
      return existing.id;
    }
    if (!src || !src.hasMesh) return null;
    const id = nextId++;
    meshKeyToId.set(key, { id, extruder });
    emittedMeshes.push({ id, body: src.body, extruder });
    return id;
  }

  function rememberObjectMeta(id: number, name: string, extruder: number, volumes: Volume[]) {
    if (!objectMeta.some((o) => o.id === id)) objectMeta.push({ id, name, extruder, volumes });
  }

  function gatherParts(node: Resolved | null, wrapper: Partial<ObjectSettings>, localTransform: string): Part[] {
    if (!node) return [];
    if (node.kind === "mesh") {
      return [{ name: wrapper.name || "", extruder: wrapper.extruder || 1, body: node.obj.body, localTransform }];
    }
    const out: Part[] = [];
    node.obj.components.forEach((c, index) => {
      const info = partInfo(wrapper, c.objectid, index);
      const childPath = c.path ? normalizePath(c.path) : node.filePath;
      const childLocal = formatTransform(multiplyTransform(localTransform, c.transform));
      const child = resolveTarget(parsedModels, childPath, c.objectid, c.transform, new Set());
      out.push(...gatherParts(child, { name: info.name, extruder: info.extruder, parts: [] }, childLocal));
    });
    return out;
  }

  const items: SourceBuildItem[] = root.buildItems.length
    ? root.buildItems
    : root.objects.map((o) => ({ objectid: o.id, transform: null, printable: "1", instanceId: 0 }));
  if (!items.length) throw new Error(NO_MODEL);

  for (const item of items) {
    const wrapper: Partial<ObjectSettings> = modelSettings[String(item.objectid)] || {};
    const resolved = resolveTarget(parsedModels, rootPath, item.objectid, item.transform, new Set());
    if (!resolved) continue;
    const printable = item.printable ?? "1";
    const source = { sourceObjectId: String(item.objectid), sourceInstanceId: item.instanceId };
    if (resolved.kind === "mesh") {
      const extruder = wrapper.extruder || 1;
      const newId = ensureMesh(resolved.filePath, resolved.objectId, extruder);
      if (!newId) continue;
      buildItems.push({ objectid: newId, transform: resolved.transform, printable, ...source });
      rememberObjectMeta(newId, wrapper.name || "", extruder, []);
      continue;
    }
    const parts = gatherParts(resolved, wrapper, IDENTITY);
    if (!parts.length) continue;
    const merged = mergePartsToMesh(parts, materialsId, colors);
    const id = nextId++;
    const extruder = wrapper.extruder || parts[0].extruder;
    emittedMeshes.push({ id, body: merged.body, extruder, merged: true });
    buildItems.push({ objectid: id, transform: item.transform, printable, ...source });
    rememberObjectMeta(id, wrapper.name || parts[0].name || "", extruder, merged.volumes);
  }

  if (!emittedMeshes.length) throw new Error(NO_MODEL);

  const metadataXml: string[] = [];
  for (const meta of root.metadata) {
    const name = meta.attrs.name;
    if (name && KEEP_META_NAMES.has(name)) metadataXml.push(formatCoreMetadata(name, meta.text));
  }
  metadataXml.push(` <metadata name="Application">Thingport</metadata>`);
  for (const [key, value] of Object.entries(mappedSettings)) {
    metadataXml.push(` <metadata name="slic3r:${escapeXml(key)}">${escapeXml(slic3rSerialize(value))}</metadata>`);
  }

  const pindexFor = (extruder: number) =>
    colors.length ? Math.min(Math.max(0, (extruder || 1) - 1), colors.length - 1) : 0;

  const buildXml = buildItems
    .map((item) => {
      const t = item.transform ? ` transform="${item.transform}"` : "";
      return `  <item objectid="${item.objectid}"${t} printable="${item.printable}"/>`;
    })
    .join("\n");

  const stats = {
    objects: emittedMeshes.length,
    buildItems: buildItems.length,
    plates: 0,
    vertices: 0,
    triangles: 0,
    paintColors: 0,
    materials: colors.length || 1,
  };

  // One object at a time: a large project's whole model is past V8's ~512 MB string limit. The
  // geometry counts in `stats` are filled in as it's consumed.
  function* modelXml(): Generator<string> {
    yield [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">`,
      metadataXml.join("\n"),
      " <resources>",
      ` ${buildBasematerialsXml(materialsId, colors, types)}`,
    ].join("\n");
    for (const mesh of emittedMeshes) {
      const body = mesh.merged
        ? mesh.body
        : applyTriangleMaterials(
            mesh.body.replace(/<component\b[^>]*\/?>/gi, "").replace(/p:[\w.-]+\s*=\s*"[^"]*"\s*/g, ""),
            materialsId,
            mesh.extruder,
            colors.length,
          );
      stats.vertices += countOccurrences(body, "<vertex ");
      stats.triangles += countOccurrences(body, "<triangle ");
      stats.paintColors += countOccurrences(body, 'paint_color="');
      yield `\n <object id="${mesh.id}" type="model" pid="${materialsId}" pindex="${pindexFor(mesh.extruder)}">${body}</object>`;
    }
    yield ["", " </resources>", " <build>", buildXml, " </build>", "</model>", ""].join("\n");
  }

  const instanceCount: Record<number, number> = {};
  for (const item of buildItems) {
    const n = instanceCount[item.objectid] || 0;
    item.outInstanceId = n;
    instanceCount[item.objectid] = n + 1;
  }
  const assignedPlates = assignInstancesToPlates(plates, buildItems);

  stats.plates = assignedPlates.length;

  return { modelXml, objectMeta, plates: assignedPlates, assembleItems: buildItems, stats };
}

function contentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    ' <Default Extension="png" ContentType="image/png"/>',
    ' <Default Extension="config" ContentType="application/octet-stream"/>',
    "</Types>",
    "",
  ].join("\n");
}

function relsXml(hasThumbnail: boolean): string {
  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_REL}"/>`,
  ];
  if (hasThumbnail) rels.push(` <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="${THUMB_REL}"/>`);
  rels.push("</Relationships>", "");
  return rels.join("\n");
}

export type NormalizeReport = {
  settings: Settings;
  projectKeys: string[];
  objects: number;
  buildItems: number;
  plates: number;
  vertices: number;
  triangles: number;
  paintColors: number;
  materials: number;
  flattened: boolean;
};

async function buildNormalizedZip(input: Buffer | Uint8Array): Promise<{ out: JSZip; report: () => NormalizeReport }> {
  const zip = await JSZip.loadAsync(input);
  const filesByKey = indexZipFiles(zip);
  const rootRec = filesByKey["3d/3dmodel.model"];
  if (!rootRec) throw new Error(NO_MODEL);

  let bambuSettings: Settings = {};
  const projectRec = filesByKey["metadata/project_settings.config"];
  if (projectRec) {
    try {
      bambuSettings = extractBambuSettings(JSON.parse(await projectRec.entry.async("string")));
    } catch {}
  }

  let modelSettings: Record<string, ObjectSettings> = {};
  let plates: PlateSettings[] = [];
  const modelSetRec = filesByKey["metadata/model_settings.config"];
  if (modelSetRec) {
    const modelXml = await modelSetRec.entry.async("string");
    modelSettings = parseModelSettings(modelXml);
    plates = parsePlates(modelXml);
  }

  const modelXmlByKey: Record<string, string> = {};
  for (const [key, rec] of Object.entries(filesByKey)) {
    if (key.endsWith(".model")) modelXmlByKey[key] = await rec.entry.async("string");
  }
  const parsedModels: Record<string, ParsedModel> = {};
  for (const [key, xml] of Object.entries(modelXmlByKey)) {
    parsedModels[key] = {
      objects: extractObjects(xml),
      buildItems: extractBuildItems(xml),
      metadata: extractModelMetadata(xml),
    };
  }

  const mappedSettings = mapSettingsToSlic3r(bambuSettings);
  const flattened = buildFlattenedModel({
    parsedModels,
    rootPath: rootRec.relativePath,
    modelSettings,
    bambuSettings,
    mappedSettings,
    plates,
  });
  const hadProduction =
    Object.keys(modelXmlByKey).some((p) => /objects\/object_/i.test(p)) ||
    /requiredextensions\s*=\s*"p"/i.test(modelXmlByKey["3d/3dmodel.model"] || "");

  const out = new JSZip();
  out.file("[Content_Types].xml", contentTypesXml());

  const thumbRec =
    filesByKey["metadata/plate_1.png"] || filesByKey["metadata/thumbnail.png"] || filesByKey["metadata/top_1.png"];
  if (thumbRec) out.file("Metadata/thumbnail.png", await thumbRec.entry.async("uint8array"));
  out.file("_rels/.rels", relsXml(Boolean(thumbRec)));
  out.file("3D/3dmodel.model", Readable.from(flattened.modelXml(), { objectMode: false }));

  const cleanedProject = normalizeProjectSettings(bambuSettings);
  if (Object.keys(cleanedProject).length) {
    out.file("Metadata/project_settings.config", JSON.stringify(cleanedProject, null, 2));
  }
  if (Object.keys(mappedSettings).length) out.file("Metadata/Slic3r_PE.config", buildSlic3rConfig(mappedSettings));
  if (flattened.objectMeta.length) {
    out.file("Metadata/Slic3r_PE_model.config", buildSlic3rModelConfig(flattened.objectMeta));
    out.file(
      "Metadata/model_settings.config",
      buildModelSettingsConfig(flattened.objectMeta, flattened.plates, flattened.assembleItems),
    );
  }

  for (const [key, rec] of Object.entries(filesByKey)) {
    if (shouldDropEntry(rec.relativePath)) continue;
    if (key === "metadata/thumbnail.png" && thumbRec) continue;
    out.file(rec.relativePath, await rec.entry.async("uint8array"));
  }

  return {
    out,
    // Geometry counts are only complete once the zip has been generated.
    report: () => ({
      settings: mappedSettings,
      projectKeys: Object.keys(cleanedProject).toSorted(),
      ...flattened.stats,
      flattened: hadProduction,
    }),
  };
}

const ZIP_OPTIONS = { compression: "DEFLATE", compressionOptions: { level: 6 } } as const;

export async function normalize3mf(
  input: Buffer | Uint8Array,
): Promise<{ bytes: Uint8Array; report: NormalizeReport }> {
  const { out, report } = await buildNormalizedZip(input);
  const bytes = await out.generateAsync({ type: "uint8array", ...ZIP_OPTIONS });
  return { bytes, report: report() };
}

/** Streams the result to `destPath`, so a large project is never held in memory as one zip. */
export async function writeNormalized3mf(input: Buffer | Uint8Array, destPath: string): Promise<NormalizeReport> {
  const { out, report } = await buildNormalizedZip(input);
  await pipeline(
    out.generateNodeStream({ type: "nodebuffer", streamFiles: true, ...ZIP_OPTIONS }),
    createWriteStream(destPath),
  );
  return report();
}
