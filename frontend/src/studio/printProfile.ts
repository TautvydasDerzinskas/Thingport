import {
  hiddenPlates,
  isBody,
  plateOf,
  profileOfPlate,
  profileSettings,
  topLevel,
  type StudioDocument,
  type StudioFilamentSlot,
} from "./document";

// A design's print profile: the slicer settings it's meant to be printed with, as a preset to start from and the
// settings changed on it, for the slicer and printer the person prints with. Settings are kept under Bambu Studio's
// names, which the 3MF Studio writes uses (Metadata/project_settings.config) and which Thingport's slicer adapter
// (backend/src/adapter/settings.ts) already turns into PrusaSlicer's and Cura's: so one profile reaches every slicer,
// and each setting says which kinds of slicer it reaches. Only the settings a profile names are written; the rest are
// the slicer's own preset for the printer.

export type SlicerFamily = "bambu" | "prusa" | "cura";
const ALL: SlicerFamily[] = ["bambu", "prusa", "cura"];

/**
 * Thingport's slicers (backend/src/adapter/slicers) by the kind of project each reads: Bambu Studio and the slicers
 * built on it share Bambu Studio's names, PrusaSlicer's family its own, Cura its own. A test keeps it in step.
 */
export const PROFILE_SLICERS: Readonly<Record<string, SlicerFamily>> = {
  bambustudio: "bambu",
  orcaslicer: "bambu",
  "snapmaker-orca": "bambu",
  elegooslicer: "bambu",
  anycubicslicernext: "bambu",
  crealityprintlink: "bambu",
  qidistudio: "bambu",
  "orca-flashforge": "bambu",
  prusaslicer: "prusa",
  eufystudio3d: "prusa",
  cura: "cura",
};

export function slicerFamily(slicer: string | undefined | null): SlicerFamily | null {
  return slicer && Object.hasOwn(PROFILE_SLICERS, slicer) ? PROFILE_SLICERS[slicer] : null;
}

/** Where a setting sits, as Bambu Studio's process tabs sort them. */
export const PROFILE_CATEGORIES = ["quality", "strength", "speed", "support", "others"] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];
type Common = {
  key: string;
  category: ProfileCategory;
  /** The kinds of slicer it reaches. */
  carries: SlicerFamily[];
  /** What each kind of slicer calls it, for a person reading a guide written for it. */
  names: Record<SlicerFamily, string>;
};
export type NumberSetting = Common & {
  kind: "number";
  unit: "mm" | "%" | "°" | "mm/s" | null;
  /** Kept per nozzle as a list (Bambu Studio's speeds), written as one. */
  list?: boolean;
  min: number;
  max: number;
  step: number;
};
export type ChoiceSetting = Common & {
  kind: "choice";
  /** Each choice, and the kinds of slicer it reaches: a choice another slicer has no match for stays this one's. */
  options: { value: string; label: string; carries: SlicerFamily[] }[];
};
export type SwitchSetting = Common & { kind: "switch" };
export type ProfileSettingDef = NumberSetting | ChoiceSetting | SwitchSetting;

const names = (bambu: string, prusa: string, cura: string) => ({ bambu, prusa, cura });
const option = (value: string, label: string, carries: SlicerFamily[] = ALL) => ({ value, label, carries });

/** By category, in the order Bambu Studio shows them. Each `carries` follows the adapter's tables
 *  (PRUSA_OBJECT_SETTINGS and the Cura ones); a setting only Bambu Studio's family takes is one of its extras. */
export const PROFILE_SETTINGS = [
  {
    key: "layer_height",
    kind: "number",
    category: "quality",
    unit: "mm",
    min: 0.04,
    max: 1,
    step: 0.01,
    carries: ALL,
    names: names("Layer height", "Layer height", "Layer Height"),
  },
  {
    key: "seam_position",
    kind: "choice",
    category: "quality",
    carries: ["bambu"],
    names: names("Seam position", "Seam position", "Z Seam Alignment"),
    options: [
      option("aligned", "Aligned", ["bambu"]),
      option("nearest", "Nearest", ["bambu"]),
      option("back", "Back", ["bambu"]),
      option("random", "Random", ["bambu"]),
    ],
  },
  {
    key: "seam_slope_type",
    kind: "choice",
    category: "quality",
    carries: ["bambu"],
    names: names("Scarf joint seam", "Scarf joint seam", "Scarf seam"),
    options: [
      option("none", "None", ["bambu"]),
      option("external", "Contour", ["bambu"]),
      option("all", "Contour and hole", ["bambu"]),
    ],
  },
  {
    key: "wall_sequence",
    kind: "choice",
    category: "quality",
    carries: ["bambu"],
    names: names("Order of walls", "Wall order", "Wall Ordering"),
    options: [
      option("inner wall/outer wall", "Inner, then outer", ["bambu"]),
      option("outer wall/inner wall", "Outer, then inner", ["bambu"]),
      option("inner-outer-inner wall", "Inner, outer, inner", ["bambu"]),
    ],
  },
  {
    key: "wall_generator",
    kind: "choice",
    category: "quality",
    carries: ["bambu", "prusa"],
    names: names("Wall generator", "Perimeter generator", "Wall generator"),
    options: [option("arachne", "Arachne", ["bambu", "prusa"]), option("classic", "Classic", ["bambu", "prusa"])],
  },
  {
    key: "ironing_type",
    kind: "choice",
    category: "quality",
    carries: ["bambu", "prusa"],
    names: names("Ironing type", "Enable ironing", "Enable Ironing"),
    options: [
      option("no ironing", "None", ["bambu", "prusa"]),
      option("topmost", "Topmost surface", ["bambu", "prusa"]),
      option("top", "All top surfaces", ["bambu", "prusa"]),
      option("solid", "All solid layers", ["bambu", "prusa"]),
    ],
  },
  {
    key: "wall_loops",
    kind: "number",
    category: "strength",
    unit: null,
    min: 0,
    max: 30,
    step: 1,
    carries: ALL,
    names: names("Wall loops", "Perimeters", "Wall Line Count"),
  },
  {
    key: "top_shell_layers",
    kind: "number",
    category: "strength",
    unit: null,
    min: 0,
    max: 50,
    step: 1,
    carries: ALL,
    names: names("Top shell layers", "Solid layers · Top", "Top Layers"),
  },
  {
    key: "bottom_shell_layers",
    kind: "number",
    category: "strength",
    unit: null,
    min: 0,
    max: 50,
    step: 1,
    carries: ALL,
    names: names("Bottom shell layers", "Solid layers · Bottom", "Bottom Layers"),
  },
  {
    key: "top_shell_thickness",
    kind: "number",
    category: "strength",
    unit: "mm",
    min: 0,
    max: 10,
    step: 0.1,
    carries: ["bambu", "prusa"],
    names: names("Top shell thickness", "Minimum shell thickness · Top", "Top Thickness"),
  },
  {
    key: "top_surface_pattern",
    kind: "choice",
    category: "strength",
    carries: ["bambu", "prusa"],
    names: names("Top surface pattern", "Top fill pattern", "Top/Bottom Pattern"),
    options: [
      option("monotonic", "Monotonic", ["bambu", "prusa"]),
      option("monotonicline", "Monotonic line", ["bambu", "prusa"]),
      option("zig-zag", "Rectilinear", ["bambu", "prusa"]),
      option("concentric", "Concentric", ["bambu", "prusa"]),
    ],
  },
  {
    key: "sparse_infill_density",
    kind: "number",
    category: "strength",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    carries: ALL,
    names: names("Sparse infill density", "Fill density", "Infill Density"),
  },
  {
    key: "sparse_infill_pattern",
    kind: "choice",
    category: "strength",
    carries: ALL,
    names: names("Sparse infill pattern", "Fill pattern", "Infill Pattern"),
    options: [
      option("grid", "Grid"),
      option("gyroid", "Gyroid"),
      option("cubic", "Cubic"),
      option("adaptivecubic", "Adaptive cubic"),
      option("triangles", "Triangles"),
      option("honeycomb", "Honeycomb", ["bambu", "prusa"]),
      option("lightning", "Lightning"),
      option("zig-zag", "Rectilinear"),
      option("concentric", "Concentric"),
    ],
  },
  {
    key: "initial_layer_speed",
    kind: "number",
    category: "speed",
    unit: "mm/s",
    list: true,
    min: 1,
    max: 1000,
    step: 1,
    carries: ["bambu"],
    names: names("Initial layer", "First layer speed", "Initial Layer Speed"),
  },
  {
    key: "outer_wall_speed",
    kind: "number",
    category: "speed",
    unit: "mm/s",
    list: true,
    min: 1,
    max: 1000,
    step: 1,
    carries: ["bambu"],
    names: names("Outer wall", "External perimeters", "Outer Wall Speed"),
  },
  {
    key: "inner_wall_speed",
    kind: "number",
    category: "speed",
    unit: "mm/s",
    list: true,
    min: 1,
    max: 1000,
    step: 1,
    carries: ["bambu"],
    names: names("Inner wall", "Perimeters", "Inner Wall Speed"),
  },
  {
    key: "sparse_infill_speed",
    kind: "number",
    category: "speed",
    unit: "mm/s",
    list: true,
    min: 1,
    max: 1000,
    step: 1,
    carries: ["bambu"],
    names: names("Sparse infill", "Infill", "Infill Speed"),
  },
  {
    key: "enable_support",
    kind: "switch",
    category: "support",
    carries: ALL,
    names: names("Enable support", "Generate support material", "Generate Support"),
  },
  {
    key: "support_type",
    kind: "choice",
    category: "support",
    carries: ["bambu", "cura"],
    names: names("Support type", "Style", "Support Structure"),
    options: [option("normal(auto)", "Normal", ["bambu", "cura"]), option("tree(auto)", "Tree", ["bambu", "cura"])],
  },
  {
    key: "support_threshold_angle",
    kind: "number",
    category: "support",
    unit: "°",
    min: 0,
    max: 90,
    step: 1,
    carries: ["bambu", "prusa"],
    names: names("Threshold angle", "Overhang threshold", "Support Overhang Angle"),
  },
  {
    key: "support_on_build_plate_only",
    kind: "switch",
    category: "support",
    carries: ALL,
    names: names("On build plate only", "Support on build plate only", "Support Placement · Touching Buildplate"),
  },
  {
    key: "raft_layers",
    kind: "number",
    category: "support",
    unit: null,
    min: 0,
    max: 10,
    step: 1,
    carries: ALL,
    names: names("Raft layers", "Raft layers", "Build Plate Adhesion Type · Raft"),
  },
  {
    key: "brim_type",
    kind: "choice",
    category: "others",
    carries: ALL,
    names: names("Brim type", "Brim type", "Build Plate Adhesion Type"),
    options: [
      // Cura gets no adhesion setting for it: its own profile's stays.
      option("no_brim", "None", ["bambu", "prusa"]),
      option("outer_only", "Outer brim"),
      option("auto_brim", "Auto", ["bambu", "prusa"]),
    ],
  },
  {
    key: "brim_width",
    kind: "number",
    category: "others",
    unit: "mm",
    min: 0,
    max: 50,
    step: 0.5,
    carries: ALL,
    names: names("Brim width", "Brim width", "Brim Width"),
  },
  {
    key: "spiral_mode",
    kind: "switch",
    category: "others",
    carries: ["bambu"],
    names: names("Spiral vase", "Spiral vase", "Spiralize Outer Contour"),
  },
  {
    key: "fuzzy_skin",
    kind: "choice",
    category: "others",
    carries: ["bambu"],
    names: names("Fuzzy skin", "Fuzzy skin", "Fuzzy Skin"),
    options: [
      option("none", "None", ["bambu"]),
      option("external", "Contour", ["bambu"]),
      option("all", "Contour and hole", ["bambu"]),
    ],
  },
] as const satisfies readonly ProfileSettingDef[];

export type ProfileSettingKey = (typeof PROFILE_SETTINGS)[number]["key"];
export type ProfileValue = number | string | boolean;
export type ProfileSettings = Partial<Record<ProfileSettingKey, ProfileValue>>;
export const PROFILE_SETTING_KEYS = PROFILE_SETTINGS.map((setting) => setting.key) as ProfileSettingKey[];

export function profileSetting(key: string): ProfileSettingDef | undefined {
  return (PROFILE_SETTINGS as readonly ProfileSettingDef[]).find((setting) => setting.key === key);
}

export type StudioFilamentMaterial = StudioFilamentSlot["material"];

export const PRINT_PRESET_IDS = [
  "standard",
  "fine",
  "draft",
  "strong",
  "outdoor",
  "water",
  "toy",
  "flexible",
  "heat",
  "vase",
  "smooth",
] as const;
export type PrintPresetId = (typeof PRINT_PRESET_IDS)[number];

export type PrintPreset = {
  id: PrintPresetId;
  /** English, for summaries and AIs; the page translates it by id. */
  title: string;
  purpose: string;
  /** The materials it suits, best first. */
  materials: StudioFilamentMaterial[];
  settings: ProfileSettings;
  /** Words in a description that point to it, for a suggestion made without an AI. */
  keywords: string[];
};

/** Starting points for a 0.4 mm nozzle; the slicer's preset for the printer covers everything they leave out. */
export const PRINT_PRESETS: readonly PrintPreset[] = [
  {
    id: "standard",
    title: "Standard",
    purpose: "Everyday parts and fit checks",
    materials: ["PLA", "PETG"],
    settings: {
      layer_height: 0.2,
      wall_loops: 2,
      top_shell_layers: 5,
      bottom_shell_layers: 3,
      sparse_infill_density: 15,
      sparse_infill_pattern: "grid",
    },
    keywords: [],
  },
  {
    id: "fine",
    title: "Fine detail",
    purpose: "Figures, miniatures, small text and curved display faces",
    materials: ["PLA"],
    settings: {
      layer_height: 0.12,
      wall_loops: 3,
      top_shell_layers: 7,
      bottom_shell_layers: 5,
      sparse_infill_density: 15,
      sparse_infill_pattern: "gyroid",
      support_type: "tree(auto)",
      seam_position: "back",
    },
    keywords: [
      "figure",
      "figurine",
      "miniature",
      "mini",
      "statue",
      "bust",
      "detail",
      "detailed",
      "sculpture",
      "model kit",
    ],
  },
  {
    id: "draft",
    title: "Quick draft",
    purpose: "Fast prototypes and fit checks",
    materials: ["PLA"],
    settings: {
      layer_height: 0.28,
      wall_loops: 2,
      top_shell_layers: 3,
      bottom_shell_layers: 3,
      sparse_infill_density: 10,
      sparse_infill_pattern: "grid",
      ironing_type: "no ironing",
    },
    keywords: ["prototype", "draft", "test fit", "fit test", "quick", "mockup", "mock-up", "placeholder"],
  },
  {
    id: "strong",
    title: "Strong",
    purpose: "Loaded and functional parts: brackets, mounts, hooks, gears",
    materials: ["PETG", "ABS", "ASA", "PA"],
    settings: {
      layer_height: 0.2,
      wall_loops: 5,
      top_shell_layers: 6,
      bottom_shell_layers: 5,
      sparse_infill_density: 35,
      sparse_infill_pattern: "gyroid",
    },
    keywords: [
      "bracket",
      "mount",
      "hook",
      "gear",
      "hinge",
      "clamp",
      "load",
      "strong",
      "sturdy",
      "functional",
      "tool",
      "wrench",
      "holder",
    ],
  },
  {
    id: "outdoor",
    title: "Outdoor",
    purpose: "Parts that stay out in sun and rain",
    materials: ["ASA", "PETG"],
    settings: {
      layer_height: 0.2,
      wall_loops: 4,
      top_shell_layers: 5,
      bottom_shell_layers: 4,
      sparse_infill_density: 25,
      sparse_infill_pattern: "gyroid",
      brim_type: "outer_only",
      brim_width: 5,
    },
    keywords: [
      "outdoor",
      "outside",
      "garden",
      "balcony",
      "patio",
      "uv",
      "sun",
      "weather",
      "rain",
      "yard",
      "fence",
      "mailbox",
      "bird",
    ],
  },
  {
    id: "water",
    title: "Water contact",
    purpose: "Parts that hold or touch water: planters, trays, vases, bath parts",
    materials: ["PETG"],
    settings: {
      layer_height: 0.2,
      wall_loops: 4,
      top_shell_layers: 6,
      bottom_shell_layers: 6,
      sparse_infill_density: 20,
      sparse_infill_pattern: "gyroid",
    },
    keywords: [
      "water",
      "watertight",
      "waterproof",
      "planter",
      "pot",
      "plant",
      "tray",
      "cup",
      "bath",
      "shower",
      "sink",
      "aquarium",
      "drain",
    ],
  },
  {
    id: "toy",
    title: "Toy",
    purpose: "Sturdy toys and things children handle",
    materials: ["PLA", "PETG"],
    settings: {
      layer_height: 0.2,
      wall_loops: 4,
      top_shell_layers: 5,
      bottom_shell_layers: 4,
      sparse_infill_density: 20,
      sparse_infill_pattern: "gyroid",
    },
    keywords: [
      "toy",
      "kid",
      "kids",
      "child",
      "children",
      "game",
      "puzzle",
      "fidget",
      "car",
      "dinosaur",
      "doll",
      "block",
    ],
  },
  {
    id: "flexible",
    title: "Flexible",
    purpose: "Bumpers, grips, feet and covers in TPU",
    materials: ["TPU"],
    settings: {
      layer_height: 0.2,
      wall_loops: 3,
      top_shell_layers: 4,
      bottom_shell_layers: 4,
      sparse_infill_density: 15,
      sparse_infill_pattern: "gyroid",
      enable_support: false,
    },
    keywords: [
      "flexible",
      "tpu",
      "rubber",
      "bumper",
      "grip",
      "foot",
      "feet",
      "gasket",
      "seal",
      "soft",
      "strap",
      "watch band",
    ],
  },
  {
    id: "heat",
    title: "Heat-resistant",
    purpose: "Parts near heat: car interiors, motors, lamps",
    materials: ["ASA", "ABS", "PC"],
    settings: {
      layer_height: 0.2,
      wall_loops: 4,
      top_shell_layers: 5,
      bottom_shell_layers: 4,
      sparse_infill_density: 25,
      sparse_infill_pattern: "gyroid",
      brim_type: "outer_only",
      brim_width: 5,
    },
    keywords: ["car", "dashboard", "vent", "heat", "hot", "motor", "engine", "lamp", "enclosure", "printer part"],
  },
  {
    id: "vase",
    title: "Vase",
    purpose: "One continuous wall: vases, lampshades, light covers",
    materials: ["PLA", "PETG"],
    settings: {
      layer_height: 0.24,
      spiral_mode: true,
      wall_loops: 1,
      top_shell_layers: 0,
      bottom_shell_layers: 4,
      sparse_infill_density: 0,
    },
    keywords: ["vase", "lampshade", "lamp shade", "spiral", "light cover", "shade"],
  },
  {
    id: "smooth",
    title: "Smooth top",
    purpose: "Signs, lids and plaques with a polished top",
    materials: ["PLA", "PETG"],
    settings: {
      layer_height: 0.16,
      wall_loops: 3,
      top_shell_layers: 7,
      bottom_shell_layers: 4,
      sparse_infill_density: 15,
      top_surface_pattern: "monotonic",
      ironing_type: "topmost",
    },
    keywords: ["sign", "plaque", "lid", "nameplate", "name plate", "label", "coaster", "logo", "badge", "smooth"],
  },
];

export function printPreset(id: string | null | undefined): PrintPreset | undefined {
  return PRINT_PRESETS.find((preset) => preset.id === id);
}

/** Who chose the profile: a person on the page, Studio's assistant, or an MCP client. */
export type ProfileAuthor = "person" | "assistant" | "mcp";

export type StudioPrintProfile = {
  /** The preset it started from; null for one built setting by setting. */
  preset: PrintPresetId | null;
  /** Its name in the library, when the person gave it one. */
  name?: string;
  /** The slicer it's for, by Thingport's slicer id (PROFILE_SLICERS). */
  slicer?: string;
  /** The printer it's for, by the printer catalogue's id, and its nozzle in mm ("0.4"). */
  printer?: { id: string; nozzle: string };
  /** The material it's meant for. */
  material?: StudioFilamentMaterial;
  settings: ProfileSettings;
  /** Why these settings, in a sentence or two: an assistant's reasoning, or the person's note. */
  reason?: string;
  by?: ProfileAuthor;
};

/** A value as the setting takes it, or a reason it can't. */
export function settingValueError(key: string, value: ProfileValue): string | null {
  const setting = profileSetting(key);
  if (!setting) return `There's no profile setting ${key}.`;
  if (setting.kind === "switch") return typeof value === "boolean" ? null : `${key} is on or off: true or false.`;
  if (setting.kind === "choice") {
    const values = setting.options.map((choice) => choice.value);
    return typeof value === "string" && values.includes(value) ? null : `${key} is one of: ${values.join(", ")}.`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return `${key} is a number.`;
  if (value < setting.min || value > setting.max)
    return `${key} is from ${setting.min} to ${setting.max}${setting.unit ? ` ${setting.unit}` : ""}.`;
  if (setting.step >= 1 && !Number.isInteger(value)) return `${key} is a whole number.`;
  return null;
}

/** As Bambu Studio writes it in project_settings.config: every value a string, a percentage with its sign. */
export function settingProjectValue(key: ProfileSettingKey, value: ProfileValue): string {
  const setting = profileSetting(key)!;
  if (setting.kind === "switch") return value ? "1" : "0";
  if (setting.kind === "choice") return String(value);
  const number = Number(Number(value).toFixed(3));
  return setting.unit === "%" ? `${number}%` : String(number);
}

/** The profile's settings for the 3MF's project_settings.config, and their keys, which go in the project's list of
 *  changes to the process preset (different_settings_to_system) so the slicer keeps them. */
export function profileProjectSettings(profile: StudioPrintProfile): {
  settings: Record<string, string | string[]>;
  keys: string[];
} {
  const settings: Record<string, string | string[]> = {};
  for (const key of PROFILE_SETTING_KEYS) {
    const value = profile.settings[key];
    if (value === undefined) continue;
    const written = settingProjectValue(key, value);
    const setting = profileSetting(key)!;
    settings[key] = setting.kind === "number" && setting.list ? [written] : written;
  }
  return { settings, keys: Object.keys(settings) };
}

/** The keys a profile sets that `family` doesn't take, so the person knows to set those in their slicer. */
export function settingsNotCarried(profile: StudioPrintProfile, family: SlicerFamily): ProfileSettingKey[] {
  return PROFILE_SETTING_KEYS.filter((key) => {
    const value = profile.settings[key];
    if (value === undefined) return false;
    const setting = profileSetting(key)!;
    if (!setting.carries.includes(family)) return true;
    return setting.kind === "choice" && !setting.options.some((o) => o.value === value && o.carries.includes(family));
  });
}

export type ProfileCheck = {
  code: "material" | "not_carried" | "food_contact" | "toy" | "vase_bodies";
  level: "warning" | "info";
  /** English, for an assistant and the design's history; the page words it from the code and params. */
  text: string;
  params?: Record<string, string | number>;
};

/** The materials a design is set to print in: its filament slots', else the profile's own. */
function materialsOf(doc: StudioDocument, profile: StudioPrintProfile, profileId?: string): StudioFilamentMaterial[] {
  const slots = profileSettings(doc, profileId).filament_slots ?? [];
  if (slots.length) return [...new Set(slots.map((slot) => slot.material))];
  return profile.material ? [profile.material] : [];
}

/** What a person should know before printing with the profile. */
export function checkProfile(doc: StudioDocument, profile: StudioPrintProfile, profileId?: string): ProfileCheck[] {
  const checks: ProfileCheck[] = [];
  const preset = printPreset(profile.preset);
  if (preset) {
    for (const material of materialsOf(doc, profile, profileId)) {
      if (preset.materials.includes(material)) continue;
      checks.push({
        code: "material",
        level: "warning",
        text: `${preset.title} parts do better in ${preset.materials.join(" or ")} than in ${material}.`,
        params: { preset: preset.id, material, suits: preset.materials.join(", ") },
      });
    }
    if (preset.id === "water")
      checks.push({
        code: "food_contact",
        level: "info",
        text: "A print profile doesn't make a part food-safe: the material grade, the printer's parts and cleaning matter too.",
      });
    if (preset.id === "toy")
      checks.push({
        code: "toy",
        level: "info",
        text: "Round sharp edges and avoid small loose pieces for young children.",
      });
  }
  if (profile.settings.spiral_mode === true) {
    const perPlate = new Map<string, number>();
    const hidden = hiddenPlates(doc);
    for (const feature of topLevel(doc)) {
      if (!isBody(feature) || !feature.visible) continue;
      const plate = plateOf(feature);
      if (hidden.has(plate) || (profileId && profileOfPlate(doc, plate) !== profileId)) continue;
      perPlate.set(plate, (perPlate.get(plate) ?? 0) + 1);
    }
    const crowded = [...perPlate].filter(([, count]) => count > 1).map(([plate]) => plate);
    if (crowded.length)
      checks.push({
        code: "vase_bodies",
        level: "warning",
        text: `Spiral vase prints one body at a time with a single wall: keep one body per plate (more on ${crowded.join(", ")}).`,
        params: { plates: crowded.join(", ") },
      });
  }
  const family = slicerFamily(profile.slicer);
  if (family) {
    const left = settingsNotCarried(profile, family);
    if (left.length)
      checks.push({
        code: "not_carried",
        level: "info",
        text: `This slicer doesn't take ${left.join(", ")} from a 3MF: set ${left.length === 1 ? "it" : "them"} there.`,
        params: { keys: left.join(", ") },
      });
  }
  return checks;
}

/** Presets a design's description points to, best first, with the words that did, for a suggestion made without an
 *  AI. Empty when nothing matches. */
export function suggestPresets(text: string): { id: PrintPresetId; words: string[] }[] {
  const plain = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return PRINT_PRESETS.map((preset) => ({
    id: preset.id,
    words: preset.keywords.filter((word) => plain.includes(` ${word} `) || plain.includes(` ${word}s `)),
  }))
    .filter((hit) => hit.words.length)
    .toSorted((a, b) => b.words.length - a.words.length);
}

/** "Outdoor · 0.2 mm layers, 4 wall loops, 25% infill · ASA": the profile in a line, in English. */
export function profileSummary(profile: StudioPrintProfile): string {
  const preset = printPreset(profile.preset);
  const { settings } = profile;
  const parts = [
    settings.spiral_mode === true ? "spiral vase" : null,
    settings.layer_height !== undefined ? `${settings.layer_height} mm layers` : null,
    settings.wall_loops !== undefined ? `${settings.wall_loops} wall loops` : null,
    settings.sparse_infill_density !== undefined ? `${settings.sparse_infill_density}% infill` : null,
    settings.enable_support === true ? "supports" : settings.enable_support === false ? "no supports" : null,
  ].filter(Boolean);
  return [profile.name ?? preset?.title ?? "Custom", parts.join(", "), profile.material].filter(Boolean).join(" · ");
}

/** Whether the settings still are the preset's, so the page can say the profile was changed from it. */
export function profileMatchesPreset(profile: StudioPrintProfile): boolean {
  const preset = printPreset(profile.preset);
  if (!preset) return false;
  const keys = new Set([...Object.keys(preset.settings), ...Object.keys(profile.settings)]) as Set<ProfileSettingKey>;
  return [...keys].every((key) => preset.settings[key] === profile.settings[key]);
}
