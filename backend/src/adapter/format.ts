// What kind of 3MF a file is, read from its entry names and a few small files, never its meshes: which slicer
// family wrote it, which app and version, and the printer it was made for.

import { asArray, firstValue, settingsDialectOf, type Settings, type SettingsDialect } from "./settings";
import { decodeXml } from "./xml";

/** Bumped when classification changes, so stored formats are read again. */
export const FORMAT_VERSION = 4;

/**
 * - bambu: Bambu Studio's layout (project_settings.config, model_settings.config, parts in 3D/Objects), which Orca
 *   and the slicers built on it write too.
 * - prusa: PrusaSlicer's (Slic3r_PE.config), which eufyMake Studio writes too.
 * - cura: a Cura project (a Cura/ folder).
 * - sliced: carries G-code, a print rather than a project.
 * - plain: none of those, geometry and maybe colours.
 */
export type ThreeMfKind = "bambu" | "prusa" | "cura" | "plain" | "sliced";

export type ThreeMfFormat = {
  v: number;
  kind: ThreeMfKind;
  /** The app that wrote it ("BambuStudio", "OrcaSlicer", "Snapmaker_Orca", "Creality_Print", "PrusaSlicer"...). */
  app: string | null;
  appVersion: string | null;
  /** The `OrcaSlicer` tag Orca 2.5 and Elegoo Slicer put beside a `BambuStudio-` Application. */
  orcaTag: string | null;
  /** The printer preset it was made for, as its settings name it. */
  printer: string | null;
  nozzle: number | null;
  filaments: number | null;
  /** Each filament a project sets up, in its slicer's order, where its settings say: for a Bambu or Prusa layout. */
  filamentList?: ThreeMfFilament[] | null;
  /** Its build plates, for a Bambu layout project. */
  plates: number | null;
  /** Whose names its settings use, where it matters. */
  dialect: SettingsDialect | null;
  /** A plain 3MF's: whether every one of its triangles is painted already, the way PrusaSlicer reads. */
  painted?: boolean | null;
};

/** A filament a project sets up. Unknown facts are null. */
export type ThreeMfFilament = {
  /** "PLA", "PETG-CF". */
  type: string | null;
  /** "#RRGGBB". */
  color: string | null;
  /** Who makes it, as its preset says ("Bambu Lab"); none for a generic one. */
  brand: string | null;
};

/** What a plain 3MF's whole model says about its colours (services/threeMfFormat.ts reads it through). */
export type PlainModelScan = { colours: number; painted: boolean };

export type ThreeMfFiles = {
  /** Every entry's path in the zip. */
  entries: string[];
  /** The start of 3D/3dmodel.model, which holds the Application metadata. */
  modelHead: string | null;
  /** Metadata/project_settings.config. */
  projectSettings: string | null;
  /** Metadata/model_settings.config. */
  modelSettings: string | null;
  /** Metadata/Slic3r_PE.config. */
  prusaConfig: string | null;
  /** For a plain 3MF, its model read through; null when it wasn't. */
  plainModel?: PlainModelScan | null;
};

const APPLICATION_RE = /<metadata\b[^>]*\bname\s*=\s*"Application"[^>]*>([^<]*)<\/metadata>/i;
const ORCA_TAG_RE = /<metadata\b[^>]*\bname\s*=\s*"OrcaSlicer"[^>]*>([^<]*)<\/metadata>/i;
const PRUSA_APPS = /^(PrusaSlicer|Slic3r|SuperSlicer|eufyMake Studio|AnkerMake Studio)/i;

/** "BambuStudio-02.08.02.61" -> BambuStudio, 02.08.02.61; "Creality_Print V7.2.1.5476 Release" -> Creality_Print, 7.2.1.5476. */
export function parseGenerator(text: string | null | undefined): { app: string | null; version: string | null } {
  const value = (text ?? "").trim();
  if (!value) return { app: null, version: null };
  const m = /^(.*?)[- ]V?(\d+(?:\.\d+)+)/.exec(value);
  if (!m || !m[1].trim()) return { app: value, version: null };
  return { app: m[1].trim(), version: m[2] };
}

const MODEL_RELATIONSHIP = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
// Under any namespace prefix; a tag inside a comment isn't an element.
const RELATIONSHIP_RE = /<(?:[\w.-]+:)?Relationship\b[^>]*>/gi;
const XML_COMMENT_RE = /<!--[\s\S]*?-->/g;

function xmlAttr(tag: string, name: string): string | null {
  const m = new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeXml(m[1] ?? m[2]) : null;
}

/** Finds entries by package part name, which ignores case and may start with "/"; the name as the zip spells it. */
export function partNames(entries: Iterable<string>): (part: string) => string | null {
  const byKey = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return (part) => byKey.get(part.replace(/^\/+/, "").toLowerCase()) ?? null;
}

/** The entry holding a 3MF's model: the one _rels/.rels names, else 3D/3dmodel.model, in any case; null with neither.
 *  Windows' 3D Builder writes 3D/3DModel.model. */
export function findStartPart(entries: Iterable<string>, rels: string | null): string | null {
  const named = partNames(entries);
  for (const tag of rels?.replace(XML_COMMENT_RE, "").match(RELATIONSHIP_RE) ?? []) {
    const target = xmlAttr(tag, "Target");
    if (!target || xmlAttr(tag, "Type")?.toLowerCase() !== MODEL_RELATIONSHIP) continue;
    const found = named(target);
    if (found) return found;
  }
  return named("3D/3dmodel.model");
}

function readJson(text: string | null): Settings | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Settings) : null;
  } catch {
    return null;
  }
}

function prusaValue(config: string | null, key: string): string | null {
  if (!config) return null;
  const m = new RegExp(String.raw`^;\s*${key}\s*=\s*(.*)$`, "m").exec(config);
  return m ? m[1].trim() || null : null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(value: unknown): string | null {
  const s = String(firstValue(value) ?? "").trim();
  return s || null;
}

const MAX_FILAMENTS = 32;

/** "#RRGGBB" from "#RRGGBB", "#RRGGBBAA" or "#RGB"; null for anything else. */
function hexColour(value: unknown): string | null {
  const s = String(value ?? "").trim();
  const long = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
  if (long) return `#${long[1].toUpperCase()}`;
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  return short
    ? `#${short
        .slice(1)
        .map((c) => c + c)
        .join("")
        .toUpperCase()}`
    : null;
}

/** The maker a filament preset names: its vendor where the project keeps one, else Bambu Lab's own presets by name. */
function brandOf(vendor: string | null, preset: string | null): string | null {
  if (vendor) return /^generic$/i.test(vendor) ? null : vendor;
  return preset && /^bambu\s/i.test(preset) ? "Bambu Lab" : null;
}

/** Slot by slot, from lists that may be different lengths. */
function filamentsOf(colours: unknown[], types: unknown[], vendors: unknown[], presets: unknown[]) {
  const count = Math.min(Math.max(colours.length, types.length, presets.length), MAX_FILAMENTS);
  if (!count) return null;
  return Array.from({ length: count }, (_, i): ThreeMfFilament => ({
    type: nonEmpty(types[i]),
    color: hexColour(colours[i]),
    brand: brandOf(nonEmpty(vendors[i]), nonEmpty(presets[i])),
  }));
}

const prusaList = (config: string | null, key: string) => prusaValue(config, key)?.split(";") ?? [];

export function classify3mf(files: ThreeMfFiles): ThreeMfFormat {
  const names = files.entries.map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase());
  const has = (name: string) => names.includes(name);
  const { app, version } = parseGenerator(files.modelHead ? APPLICATION_RE.exec(files.modelHead)?.[1] : null);
  const orcaTag = files.modelHead ? (ORCA_TAG_RE.exec(files.modelHead)?.[1].trim() ?? null) || null : null;
  const base = { v: FORMAT_VERSION, app, appVersion: version, orcaTag };

  const empty = { printer: null, nozzle: null, filaments: null, plates: null, dialect: null };
  if (names.some((name) => name.endsWith(".gcode"))) return { ...base, kind: "sliced", ...empty };

  const prusaApp = app !== null && PRUSA_APPS.test(app);
  // model_settings.config alone isn't a project: Thingport's own tools write one beside the colour groups and
  // painting they give every slicer.
  const bambuLayout = has("metadata/project_settings.config") || names.some((name) => name.startsWith("3d/objects/"));
  if (bambuLayout && !prusaApp) {
    const settings = readJson(files.projectSettings) ?? {};
    const plates = files.modelSettings ? (files.modelSettings.match(/<plate>/gi)?.length ?? 0) : 0;
    const filaments = asArray(settings.filament_colour).length || asArray(settings.filament_settings_id).length;
    return {
      ...base,
      kind: "bambu",
      printer: nonEmpty(settings.printer_settings_id) ?? nonEmpty(settings.printer_model),
      nozzle: numberOrNull(firstValue(settings.nozzle_diameter)),
      filaments: filaments || null,
      filamentList: filamentsOf(
        asArray(settings.filament_colour),
        asArray(settings.filament_type),
        asArray(settings.filament_vendor),
        asArray(settings.filament_settings_id),
      ),
      plates: plates || null,
      dialect: settingsDialectOf(settings),
    };
  }

  if (prusaApp || has("metadata/slic3r_pe.config") || has("metadata/slic3r_pe_model.config")) {
    const colours = prusaValue(files.prusaConfig, "filament_colour");
    return {
      ...base,
      kind: "prusa",
      ...empty,
      printer: prusaValue(files.prusaConfig, "printer_settings_id") ?? prusaValue(files.prusaConfig, "printer_model"),
      nozzle: numberOrNull(prusaValue(files.prusaConfig, "nozzle_diameter")?.split(/[,;]/)[0]),
      filaments: colours ? colours.split(";").length : null,
      filamentList: filamentsOf(
        prusaList(files.prusaConfig, "filament_colour"),
        prusaList(files.prusaConfig, "filament_type"),
        prusaList(files.prusaConfig, "filament_vendor"),
        prusaList(files.prusaConfig, "filament_settings_id"),
      ),
    };
  }

  if (names.some((name) => name.startsWith("cura/"))) return { ...base, kind: "cura", ...empty };
  // The colours a plain 3MF gives its objects and triangles, for the slicers that read none.
  const scan = files.plainModel;
  return {
    ...base,
    kind: "plain",
    ...empty,
    ...(scan ? { filaments: scan.colours || null, painted: scan.painted } : {}),
  };
}

/** The format as stored, its own fields only, or null for one an older classification wrote (read it again). */
export function storedFormat(value: unknown): ThreeMfFormat | null {
  if (!value || typeof value !== "object") return null;
  const f = value as Partial<ThreeMfFormat>;
  if (f.v !== FORMAT_VERSION || typeof f.kind !== "string") return null;
  return {
    v: f.v,
    kind: f.kind,
    app: f.app ?? null,
    appVersion: f.appVersion ?? null,
    orcaTag: f.orcaTag ?? null,
    printer: f.printer ?? null,
    nozzle: f.nozzle ?? null,
    filaments: f.filaments ?? null,
    filamentList: f.filamentList ?? null,
    plates: f.plates ?? null,
    dialect: f.dialect ?? null,
    ...(f.painted !== undefined ? { painted: f.painted } : {}),
  };
}
