// A project's settings as Bambu Studio and the slicers built on it store them (Metadata/project_settings.config), and
// what each other kind of slicer can take of them.

export type Settings = Record<string, unknown>;

export function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// Printer/machine profile keys: they'd drag the designer's printer into a copy that isn't for it.
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

/** The settings a project uses, with the legacy nested `process_settings["1"]` merged in. */
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

/** The project's settings without its printer, machine limits, G-code and "inherit" sentinels. */
export function normalizeProjectSettings(config: Settings): Settings {
  const out: Settings = {};
  for (const [key, value] of Object.entries(extractBambuSettings(config))) {
    if (shouldStripSettingKey(key) || isUnsetFilamentSlot(key, value)) continue;
    const cleaned = normalizeSettingValue(value);
    if (cleaned === undefined) continue;
    out[key] = cleaned;
  }
  const filaments = asArray(out.filament_colour);
  if (filaments.length && filaments.length > asArray(out.extruder_colour).length) out.extruder_colour = filaments;
  return out;
}

/**
 * The names Bambu Studio and the Orca family give the same choices, where they differ. A file carries one family's
 * names; a slicer of the other family replaces what it doesn't know with its default and, all but Orca itself,
 * says so in a dialog on every open.
 */
export type SettingsDialect = "bambu" | "orca";

const VERTICAL_SHELL_TO: Record<SettingsDialect, Record<string, string>> = {
  orca: { enabled: "ensure_all", partial: "ensure_moderate", disabled: "none" },
  bambu: { ensure_all: "enabled", ensure_moderate: "partial", ensure_critical_only: "partial", none: "disabled" },
};

/** Which family's names a project's settings use, or null when nothing in them tells the two apart. */
export function settingsDialectOf(config: Settings): SettingsDialect | null {
  const shell = String(firstValue(extractBambuSettings(config).ensure_vertical_shell_thickness) ?? "");
  if (shell in VERTICAL_SHELL_TO.orca) return "bambu";
  if (shell in VERTICAL_SHELL_TO.bambu) return "orca";
  return null;
}

/** One `ensure_vertical_shell_thickness` value in `dialect`'s names; others pass as they are. */
export function verticalShellIn(dialect: SettingsDialect, value: string): string {
  return VERTICAL_SHELL_TO[dialect][value] ?? value;
}

function shellIn(dialect: SettingsDialect, config: Settings): Settings {
  const shell = config.ensure_vertical_shell_thickness;
  if (shell === undefined) return config;
  const translated = Array.isArray(shell)
    ? shell.map((value) => verticalShellIn(dialect, String(value)))
    : verticalShellIn(dialect, String(shell));
  return { ...config, ensure_vertical_shell_thickness: translated };
}

/** The project's settings with their names in `dialect`, the legacy nested `process_settings["1"]` too. */
export function settingsIn(dialect: SettingsDialect, config: Settings): Settings {
  const out = shellIn(dialect, config);
  const processSettings = config.process_settings;
  if (!processSettings || typeof processSettings !== "object" || Array.isArray(processSettings)) return out;
  const nested = (processSettings as Record<string, unknown>)["1"];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return out;
  return { ...out, process_settings: { ...processSettings, "1": shellIn(dialect, nested as Settings) } };
}

// Values that read alike across slicers.
const asNumber = (value: unknown): string | null => {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? String(n) : null;
};
const asInteger = (value: unknown): string | null => {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? String(Math.round(n)) : null;
};
const asPercentOrNumber = (value: unknown): string | null => {
  const s = String(value).trim();
  if (/^-?\d+(\.\d+)?%$/.test(s)) return s;
  return asNumber(s);
};
const asBool = (value: unknown): string =>
  value === true || value === 1 || ["1", "true"].includes(String(value).trim().toLowerCase()) ? "1" : "0";
const oneOf =
  (map: Record<string, string>) =>
  (value: unknown): string | null =>
    map[String(value).trim().toLowerCase()] ?? null;

// PrusaSlicer's names for Bambu's choices; anything without one is left to the user's own profile.
const PRUSA_FILL: Record<string, string> = {
  rectilinear: "rectilinear",
  alignedrectilinear: "alignedrectilinear",
  grid: "grid",
  crosshatch: "grid",
  triangles: "triangles",
  "tri-hexagon": "stars",
  cubic: "cubic",
  line: "line",
  concentric: "concentric",
  honeycomb: "honeycomb",
  "3dhoneycomb": "3dhoneycomb",
  gyroid: "gyroid",
  hilbertcurve: "hilbertcurve",
  archimedeanchords: "archimedeanchords",
  octagramspiral: "octagramspiral",
  adaptivecubic: "adaptivecubic",
  supportcubic: "supportcubic",
  lightning: "lightning",
  "zig-zag": "zigzag",
  zigzag: "zigzag",
};
const PRUSA_SURFACE: Record<string, string> = {
  rectilinear: "rectilinear",
  "zig-zag": "rectilinear",
  monotonic: "monotonic",
  monotonicline: "monotoniclines",
  alignedrectilinear: "alignedrectilinear",
  concentric: "concentric",
  hilbertcurve: "hilbertcurve",
  archimedeanchords: "archimedeanchords",
  octagramspiral: "octagramspiral",
};
const PRUSA_SUPPORT: Record<string, string> = {
  rectilinear: "rectilinear",
  "rectilinear-grid": "rectilinear-grid",
  honeycomb: "honeycomb",
};
const PRUSA_SUPPORT_INTERFACE: Record<string, string> = {
  auto: "auto",
  rectilinear: "rectilinear",
  rectilinear_interlaced: "rectilinear",
  concentric: "concentric",
};
const PRUSA_BRIM: Record<string, string> = {
  auto_brim: "outer_only",
  brim_ears: "outer_only",
  painted: "outer_only",
  outer_only: "outer_only",
  inner_only: "inner_only",
  outer_and_inner: "outer_and_inner",
  no_brim: "no_brim",
};
const PRUSA_GENERATOR: Record<string, string> = { arachne: "arachne", classic: "classic" };
const PRUSA_VERTICAL_SHELL: Record<string, string> = {
  enabled: "enabled",
  partial: "partial",
  disabled: "disabled",
  ensure_all: "enabled",
  ensure_moderate: "partial",
  ensure_critical_only: "partial",
  none: "disabled",
  "1": "enabled",
  "0": "disabled",
};

/**
 * The designer's choices PrusaSlicer keeps per object, by Bambu key: what that object is printed with on top of the
 * user's own profile. Only keys PrusaSlicer 2.9 lists in PrintObjectConfig or PrintRegionConfig, and none that belong
 * to a nozzle or printer (line widths, elephant foot), which the user's own profile knows better.
 */
const PRUSA_OBJECT_SETTINGS: Record<string, [string, (value: unknown) => string | null]> = {
  layer_height: ["layer_height", asNumber],
  wall_loops: ["perimeters", asInteger],
  top_shell_layers: ["top_solid_layers", asInteger],
  bottom_shell_layers: ["bottom_solid_layers", asInteger],
  top_shell_thickness: ["top_solid_min_thickness", asNumber],
  bottom_shell_thickness: ["bottom_solid_min_thickness", asNumber],
  sparse_infill_density: ["fill_density", asPercentOrNumber],
  sparse_infill_pattern: ["fill_pattern", oneOf(PRUSA_FILL)],
  top_surface_pattern: ["top_fill_pattern", oneOf(PRUSA_SURFACE)],
  bottom_surface_pattern: ["bottom_fill_pattern", oneOf(PRUSA_SURFACE)],
  infill_direction: ["fill_angle", asNumber],
  infill_wall_overlap: ["infill_overlap", asPercentOrNumber],
  enable_support: ["support_material", asBool],
  support_threshold_angle: ["support_material_threshold", asInteger],
  support_on_build_plate_only: ["support_material_buildplate_only", asBool],
  support_object_xy_distance: ["support_material_xy_spacing", asPercentOrNumber],
  support_top_z_distance: ["support_material_contact_distance", asNumber],
  support_base_pattern: ["support_material_pattern", oneOf(PRUSA_SUPPORT)],
  support_interface_pattern: ["support_material_interface_pattern", oneOf(PRUSA_SUPPORT_INTERFACE)],
  support_interface_top_layers: ["support_material_interface_layers", asInteger],
  tree_support_branch_angle: ["support_tree_angle", asNumber],
  tree_support_branch_diameter: ["support_tree_branch_diameter", asNumber],
  // Not the branch distance: Bambu's is between its own tree's nodes, PrusaSlicer's between organic branches.
  raft_layers: ["raft_layers", asInteger],
  brim_type: ["brim_type", oneOf(PRUSA_BRIM)],
  brim_width: ["brim_width", asNumber],
  detect_thin_wall: ["thin_walls", asBool],
  wall_generator: ["perimeter_generator", oneOf(PRUSA_GENERATOR)],
  ensure_vertical_shell_thickness: ["ensure_vertical_shell_thickness", oneOf(PRUSA_VERTICAL_SHELL)],
  ironing_type: [
    "ironing",
    (value) => (["", "no ironing", "none", "no_ironing"].includes(String(value).trim().toLowerCase()) ? "0" : "1"),
  ],
  ironing_flow: ["ironing_flowrate", asPercentOrNumber],
  ironing_spacing: ["ironing_spacing", asNumber],
};

function objectSettings(
  settings: Settings,
  table: Record<string, [string, (value: unknown) => string | null]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [bambuKey, [key, convert]] of Object.entries(table)) {
    const raw = firstValue(settings[bambuKey]);
    if (raw == null || raw === "" || isSentinelSettingToken(raw)) continue;
    const value = convert(raw);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** The designer's settings as PrusaSlicer per-object settings, keyed by PrusaSlicer's names. */
export function prusaObjectSettings(settings: Settings): Record<string, string> {
  return objectSettings(settings, PRUSA_OBJECT_SETTINGS);
}

// The ones PrusaSlicer also takes from a part or a modifier (PrintRegionConfig); the rest are the whole object's.
const PRUSA_REGION_KEYS = new Set([
  "perimeters",
  "top_solid_layers",
  "bottom_solid_layers",
  "top_solid_min_thickness",
  "bottom_solid_min_thickness",
  "fill_density",
  "fill_pattern",
  "top_fill_pattern",
  "bottom_fill_pattern",
  "fill_angle",
  "infill_overlap",
  "thin_walls",
  "ensure_vertical_shell_thickness",
  "ironing",
  "ironing_flowrate",
  "ironing_spacing",
]);

/** A part's or modifier's own settings as PrusaSlicer per-volume settings. */
export function prusaVolumeSettings(settings: Settings): Record<string, string> {
  return Object.fromEntries(
    Object.entries(prusaObjectSettings(settings)).filter(([key]) => PRUSA_REGION_KEYS.has(key)),
  );
}

// Cura's own names for the few choices it takes per object from a 3MF (`cura:` metadata).
const CURA_FILL: Record<string, string> = {
  grid: "grid",
  crosshatch: "grid",
  line: "lines",
  rectilinear: "lines",
  triangles: "triangles",
  "tri-hexagon": "trihexagon",
  cubic: "cubic",
  adaptivecubic: "cubicsubdiv",
  concentric: "concentric",
  "zig-zag": "zigzag",
  zigzag: "zigzag",
  gyroid: "gyroid",
  lightning: "lightning",
};

const CURA_OBJECT_SETTINGS: Record<string, [string, (value: unknown) => string | null]> = {
  wall_loops: ["wall_line_count", asInteger],
  top_shell_layers: ["top_layers", asInteger],
  bottom_shell_layers: ["bottom_layers", asInteger],
  sparse_infill_density: ["infill_sparse_density", (value) => asNumber(String(value).replace(/%$/, ""))],
  sparse_infill_pattern: ["infill_pattern", oneOf(CURA_FILL)],
  enable_support: ["support_enable", (value) => (asBool(value) === "1" ? "True" : "False")],
};

/** The designer's settings as Cura per-object settings, keyed by Cura's names. */
export function curaObjectSettings(settings: Settings): Record<string, string> {
  return objectSettings(settings, CURA_OBJECT_SETTINGS);
}

/** A UCP's user settings by stack ("global", "extruder_0"...), each value of the setting's own type. */
export type CuraStackSettings = Record<string, Record<string, string | number | boolean>>;

const EXPLICIT_BRIMS = new Set(["outer_only", "inner_only", "outer_and_inner"]);

/**
 * The designer's settings Cura takes only for a whole print, never per object, by the stack it keeps each on
 * (fdmprinter.def.json: settable_per_extruder): the layer height, a raft or a brim and its width, and when supports are
 * on, their kind and where they stand. What's off, an automatic brim among it, is left to the user's profile. A
 * per-extruder setting goes on each of the `extruders` the copy uses; Cura skips one the printer hasn't.
 */
export function curaPrintSettings(settings: Settings, extruders: number): CuraStackSettings {
  const global: Record<string, string | number | boolean> = {};
  const perExtruder: Record<string, number> = {};
  const layerHeight = Number(firstValue(settings.layer_height));
  if (layerHeight > 0) global.layer_height = layerHeight;
  const raft = Number(firstValue(settings.raft_layers));
  const brim = String(firstValue(settings.brim_type) ?? "").trim();
  if (raft > 0) global.adhesion_type = "raft";
  else if (EXPLICIT_BRIMS.has(brim)) {
    global.adhesion_type = "brim";
    const width = Number(firstValue(settings.brim_width));
    if (width > 0) perExtruder.brim_width = width;
  }
  if (asBool(firstValue(settings.enable_support)) === "1") {
    global.support_structure = String(firstValue(settings.support_type) ?? "").startsWith("tree") ? "tree" : "normal";
    global.support_type =
      asBool(firstValue(settings.support_on_build_plate_only)) === "1" ? "buildplate" : "everywhere";
  }
  const out: CuraStackSettings = { global };
  if (Object.keys(perExtruder).length)
    for (let i = 0; i < Math.max(1, extruders); i++) out[`extruder_${i}`] = { ...perExtruder };
  return out;
}

// The other way, for a copy of a PrusaSlicer project: its settings by Bambu Studio's names, which the Orca family
// reads too (it takes `zig-zag` as its `rectilinear`, PrintConfig.cpp handle_legacy). Organic supports are named
// apart, so `dialect` says whose.
const BAMBU_FILL: Record<string, string> = {
  rectilinear: "zig-zag",
  alignedrectilinear: "alignedrectilinear",
  monotonic: "monotonic",
  monotoniclines: "monotonicline",
  grid: "grid",
  triangles: "triangles",
  stars: "tri-hexagon",
  cubic: "cubic",
  line: "line",
  concentric: "concentric",
  honeycomb: "honeycomb",
  "3dhoneycomb": "3dhoneycomb",
  gyroid: "gyroid",
  hilbertcurve: "hilbertcurve",
  archimedeanchords: "archimedeanchords",
  octagramspiral: "octagramspiral",
  adaptivecubic: "adaptivecubic",
  supportcubic: "supportcubic",
  lightning: "lightning",
  zigzag: "zigzag",
};
const BAMBU_SURFACE: Record<string, string> = {
  rectilinear: "zig-zag",
  monotonic: "monotonic",
  monotoniclines: "monotonicline",
  alignedrectilinear: "alignedrectilinear",
  concentric: "concentric",
  hilbertcurve: "hilbertcurve",
  archimedeanchords: "archimedeanchords",
  octagramspiral: "octagramspiral",
};
const BAMBU_SUPPORT: Record<string, string> = {
  rectilinear: "rectilinear",
  "rectilinear-grid": "rectilinear-grid",
  honeycomb: "honeycomb",
};
const BAMBU_SUPPORT_INTERFACE: Record<string, string> = {
  auto: "auto",
  rectilinear: "rectilinear",
  concentric: "concentric",
};
const BAMBU_BRIM: Record<string, string> = {
  no_brim: "no_brim",
  outer_only: "outer_only",
  inner_only: "inner_only",
  outer_and_inner: "outer_and_inner",
};
const BAMBU_SEAM: Record<string, string> = { aligned: "aligned", nearest: "nearest", rear: "back", random: "random" };
const BAMBU_FUZZY: Record<string, string> = { none: "none", external: "external", all: "all" };
const BAMBU_IRONING: Record<string, string> = { top: "top", topmost: "topmost", solid: "solid" };

/** By PrusaSlicer key: the Bambu key and its value. Only the design's choices (walls, layers, infill, supports,
 *  brim, ironing, seam), none that belong to a printer or a filament, which the user's own profile knows better. */
const BAMBU_FROM_PRUSA: Record<string, [string, (value: unknown) => string | null]> = {
  layer_height: ["layer_height", asNumber],
  perimeters: ["wall_loops", asInteger],
  top_solid_layers: ["top_shell_layers", asInteger],
  bottom_solid_layers: ["bottom_shell_layers", asInteger],
  top_solid_min_thickness: ["top_shell_thickness", asNumber],
  bottom_solid_min_thickness: ["bottom_shell_thickness", asNumber],
  fill_density: ["sparse_infill_density", asPercentOrNumber],
  fill_pattern: ["sparse_infill_pattern", oneOf(BAMBU_FILL)],
  top_fill_pattern: ["top_surface_pattern", oneOf(BAMBU_SURFACE)],
  bottom_fill_pattern: ["bottom_surface_pattern", oneOf(BAMBU_SURFACE)],
  fill_angle: ["infill_direction", asNumber],
  infill_overlap: ["infill_wall_overlap", asPercentOrNumber],
  support_material: ["enable_support", asBool],
  support_material_threshold: ["support_threshold_angle", asInteger],
  support_material_buildplate_only: ["support_on_build_plate_only", asBool],
  // In mm only: PrusaSlicer's may be a share of the line width, which Bambu's isn't.
  support_material_xy_spacing: ["support_object_xy_distance", asNumber],
  support_material_contact_distance: ["support_top_z_distance", asNumber],
  support_material_pattern: ["support_base_pattern", oneOf(BAMBU_SUPPORT)],
  support_material_interface_pattern: ["support_interface_pattern", oneOf(BAMBU_SUPPORT_INTERFACE)],
  support_material_interface_layers: ["support_interface_top_layers", asInteger],
  raft_layers: ["raft_layers", asInteger],
  brim_type: ["brim_type", oneOf(BAMBU_BRIM)],
  brim_width: ["brim_width", asNumber],
  thin_walls: ["detect_thin_wall", asBool],
  perimeter_generator: ["wall_generator", oneOf(PRUSA_GENERATOR)],
  ensure_vertical_shell_thickness: ["ensure_vertical_shell_thickness", oneOf(PRUSA_VERTICAL_SHELL)],
  ironing_flowrate: ["ironing_flow", asPercentOrNumber],
  ironing_spacing: ["ironing_spacing", asNumber],
  seam_position: ["seam_position", oneOf(BAMBU_SEAM)],
  fuzzy_skin: ["fuzzy_skin", oneOf(BAMBU_FUZZY)],
  fuzzy_skin_thickness: ["fuzzy_skin_thickness", asNumber],
  fuzzy_skin_point_dist: ["fuzzy_skin_point_distance", asNumber],
};

// The ones a part or a modifier takes (PrintRegionConfig), by Bambu key; the rest are the whole object's.
const BAMBU_REGION_KEYS = new Set([
  "wall_loops",
  "top_shell_layers",
  "bottom_shell_layers",
  "top_shell_thickness",
  "bottom_shell_thickness",
  "sparse_infill_density",
  "sparse_infill_pattern",
  "top_surface_pattern",
  "bottom_surface_pattern",
  "infill_direction",
  "infill_wall_overlap",
  "detect_thin_wall",
  "ensure_vertical_shell_thickness",
  "ironing_type",
  "ironing_flow",
  "ironing_spacing",
  "fuzzy_skin",
  "fuzzy_skin_thickness",
  "fuzzy_skin_point_distance",
]);

/**
 * PrusaSlicer settings, of a project or of one object or part, by the names Bambu Studio (dialect "bambu") or the
 * Orca family ("orca") gives them. Settings PrusaSlicer splits in two (supports' style and whether they're automatic,
 * whether to iron and how) come out as one; a brim of no width is no brim.
 */
export function bambuSettingsFromPrusa(
  prusa: Record<string, string>,
  dialect: SettingsDialect,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, [bambuKey, convert]] of Object.entries(BAMBU_FROM_PRUSA)) {
    if (!Object.hasOwn(prusa, key) || prusa[key] === "") continue;
    const value = convert(prusa[key]);
    if (value !== null) out[bambuKey] = value;
  }
  if (out.ensure_vertical_shell_thickness)
    out.ensure_vertical_shell_thickness = verticalShellIn(dialect, out.ensure_vertical_shell_thickness);
  if (out.brim_width === "0") out.brim_type = "no_brim";
  const style = String(prusa.support_material_style ?? "").trim();
  if (style || prusa.support_material_auto !== undefined) {
    const tree = style === "organic" || style === "tree";
    const auto = prusa.support_material_auto === undefined || asBool(prusa.support_material_auto) === "1";
    out.support_type = `${tree ? "tree" : "normal"}(${auto ? "auto" : "manual"})`;
    if (tree) out.support_style = dialect === "orca" ? "organic" : "tree_organic";
    else if (style === "grid" || style === "snug") out.support_style = style;
  }
  if (prusa.ironing !== undefined) {
    out.ironing_type =
      asBool(prusa.ironing) === "1" ? (oneOf(BAMBU_IRONING)(prusa.ironing_type) ?? "top") : "no ironing";
  }
  return out;
}

/** The part's or modifier's share of `bambuSettingsFromPrusa`. */
export function bambuRegionSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => BAMBU_REGION_KEYS.has(key)));
}
