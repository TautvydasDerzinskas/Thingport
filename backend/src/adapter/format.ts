// What kind of 3MF a file is, read from its entry names and a few small files, never its meshes: which slicer
// family wrote it, which app and version, and the printer it was made for.

import { asArray, firstValue, settingsDialectOf, type Settings, type SettingsDialect } from "./settings";

/** Bumped when classification changes, so stored formats are read again. */
export const FORMAT_VERSION = 3;

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
  /** Its build plates, for a Bambu layout project. */
  plates: number | null;
  /** Whose names its settings use, where it matters. */
  dialect: SettingsDialect | null;
  /** A plain 3MF's: whether every one of its triangles is painted already, the way PrusaSlicer reads. */
  painted?: boolean | null;
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
    plates: f.plates ?? null,
    dialect: f.dialect ?? null,
    ...(f.painted !== undefined ? { painted: f.painted } : {}),
  };
}
