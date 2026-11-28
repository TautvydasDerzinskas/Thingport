// A 3MF looked at for one site (types.ts): what the site would refuse, and the copy Thingport uploads instead, made the
// site's slicer's project for the printer with what it would refuse fixed. The file itself is never changed.

import JSZip from "jszip";
import { adapt3mf, classify3mf, planAdaptation, slicerProfile, type ThreeMfFormat } from "../../adapter";
import { readBambuPackage } from "../../adapter/readers/bambuProject";
import { asArray, firstValue, type Settings } from "../../adapter/settings";
import { printerForName, printerSummary } from "../../printers/catalogue";
import { printerTarget } from "../../printers/targets";
import { convexHull, hullMeetsBox, plateFootprint } from "./footprint";
import { printedHeights, readLayout, type Box2, type Layout, type LayoutItem, type LayoutPlate } from "./layout";
import { mergeLoses, mergeObjects, SIDE_FILES, sideFilePlaces } from "./merge";
import { overlappingGroups } from "./overlap";
import type { ThreeMfCheckOptions, ThreeMfCheckResult, ThreeMfIssue, ThreeMfPrinter, ThreeMfRules } from "./types";
import { placeTower, towerClear, towerSettings, type TowerPlate } from "./wipeTower";

// Past the bed's edge or height by less than this is on it.
const EDGE = 0.05;

/** A zip entry by its name in any case. */
function entryNamed(zip: JSZip, name: string): JSZip.JSZipObject | null {
  return Object.values(zip.files).find((file) => !file.dir && file.name.toLowerCase() === name.toLowerCase()) ?? null;
}

async function textOf(zip: JSZip, name: string): Promise<string | null> {
  return (await entryNamed(zip, name)?.async("string")) ?? null;
}

async function formatOf(zip: JSZip): Promise<ThreeMfFormat> {
  const root = await textOf(zip, "3D/3dmodel.model");
  return classify3mf({
    entries: Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name),
    modelHead: root ? root.slice(0, 256 * 1024) : null,
    projectSettings: await textOf(zip, "Metadata/project_settings.config"),
    modelSettings: await textOf(zip, "Metadata/model_settings.config"),
    prusaConfig: await textOf(zip, "Metadata/Slic3r_PE.config"),
  });
}

function projectSettings(text: string | null): Settings {
  try {
    const parsed: unknown = JSON.parse(text ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}

const nozzleOf = (value: unknown) => {
  const n = Number(firstValue(value));
  return Number.isFinite(n) && n > 0 ? String(n) : null;
};

/** The printer the project names, where it's one of the brand's: by its printer preset (`system`, the slicer's own),
 *  else by its printer model, on the user's own preset. */
function filePrinter(settings: Settings, brand: string): { printer: ThreeMfPrinter; system: boolean } | null {
  const nozzle = nozzleOf(settings.nozzle_diameter);
  const preset = printerForName(String(firstValue(settings.printer_settings_id) ?? ""));
  if (preset?.printer.brand === brand)
    return { printer: { id: preset.printer.id, nozzle: preset.nozzle ?? nozzle ?? "0.4" }, system: true };
  const model = printerForName(String(firstValue(settings.printer_model) ?? ""));
  if (model?.printer.brand === brand)
    return { printer: { id: model.printer.id, nozzle: nozzle ?? "0.4" }, system: false };
  return null;
}

function towerEnabled(settings: Settings): boolean {
  const value = firstValue(settings.enable_prime_tower);
  return !(value === "0" || value === 0 || value === false || value === "false");
}

const xyOf = (item: LayoutItem): Box2 => ({
  minX: item.bounds.min[0],
  minY: item.bounds.min[1],
  maxX: item.bounds.max[0],
  maxY: item.bounds.max[1],
});

/** Whether the item prints on `area` of its plate, as Bambu Studio tests it: each part's outline from above, its
 *  convex hull, against the area. */
function onArea(item: LayoutItem, origin: [number, number], area: Box2): boolean {
  const box = xyOf(item);
  if (box.maxX <= area.minX || box.minX >= area.maxX || box.maxY <= area.minY || box.minY >= area.maxY) return false;
  return item.parts.some(({ mesh, matrix: t }) => {
    const p = mesh.positions;
    const xy = new Float64Array((p.length / 3) * 2);
    for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
      xy[j] = p[i] * t[0] + p[i + 1] * t[3] + p[i + 2] * t[6] + t[9] - origin[0];
      xy[j + 1] = p[i] * t[1] + p[i + 1] * t[4] + p[i + 2] * t[7] + t[10] - origin[1];
    }
    return hullMeetsBox(convexHull(xy), area);
  });
}

/** How high a group prints once it's one object: the slicer lowers that onto the bed by its lowest point, which can
 *  leave it taller than any of its objects was alone. */
function mergedTop(group: LayoutItem[]): number {
  const bottom = Math.min(...group.map((item) => item.world.min[2]));
  return Math.max(...group.map((item) => item.world.max[2])) - Math.max(bottom, 0);
}

const filamentsOn = (plate: LayoutPlate) => new Set(plate.items.flatMap((item) => [...item.filaments])).size;

function towerPlate(plate: LayoutPlate, layout: Layout): TowerPlate {
  return {
    footprint: plateFootprint(plate, layout.bed, layout.exclude),
    filaments: filamentsOn(plate),
    height: Math.max(0, ...plate.items.map((item) => printedHeights(item)[1])),
  };
}

export type ThreeMfCheckRun = { result: ThreeMfCheckResult; zip: JSZip | null };

/** What the site would refuse of the file, and the copy to upload instead: null when the file needs nothing, or has
 *  something only the slicer can fix. */
export async function runThreeMfCheck(
  input: Uint8Array | JSZip,
  rules: ThreeMfRules,
  options: ThreeMfCheckOptions = {},
): Promise<ThreeMfCheckRun> {
  const checks = new Set(rules.checks);
  const issues: ThreeMfIssue[] = [];
  const done = (printer: ThreeMfPrinter | null, needsPrinter = false): ThreeMfCheckRun => ({
    result: { printer, needsPrinter, issues },
    zip: null,
  });
  const source = input instanceof JSZip ? input : await JSZip.loadAsync(input).catch(() => null);
  if (!source || !entryNamed(source, "3D/3dmodel.model")) {
    issues.push({ check: "project", problem: "unreadable", plate: null, fix: null });
    return done(null);
  }

  const format = await formatOf(source);
  if (format.kind === "sliced") {
    if (checks.has("sliced")) issues.push({ check: "sliced", problem: "sliced", plate: null, fix: null });
    return done(null);
  }
  if (format.kind !== "bambu" && format.kind !== "prusa") {
    if (checks.has("project")) issues.push({ check: "project", problem: "not-a-project", plate: null, fix: null });
    return done(null);
  }

  // The printer: the one asked for, else the file's where it's one of the brand's.
  const own =
    format.kind === "bambu"
      ? filePrinter(projectSettings(await textOf(source, "Metadata/project_settings.config")), rules.brand)
      : null;
  const asked = options.printer && printerSummary(options.printer.id)?.brand === rules.brand ? options.printer : null;
  const chosen = asked ?? own?.printer ?? null;
  const target = chosen ? printerTarget(rules.slicer, chosen.id, chosen.nozzle) : null;
  if (!chosen || !target) {
    if (checks.has("project"))
      issues.push({
        check: "project",
        problem: format.kind === "prusa" ? "other-slicer" : "other-printer",
        plate: null,
        fix: format.kind === "prusa" ? "convert" : "retarget",
      });
    return done(null, true);
  }
  const printer: ThreeMfPrinter = { id: chosen.id, nozzle: target.choice.nozzle };

  // The slicer's own project for that printer, through the adapter, which Thingport opens files in slicers with too.
  const plan = checks.has("project") ? planAdaptation(format, slicerProfile(rules.slicer), target.choice) : null;
  let changed = Boolean(plan);
  if (plan) {
    const sameAsOwn = own && own.printer.id === printer.id && own.printer.nozzle === printer.nozzle;
    issues.push({
      check: "project",
      problem:
        format.kind === "prusa"
          ? "other-slicer"
          : plan.output === "bambu" && plan.printer
            ? sameAsOwn && !own.system
              ? "custom-printer"
              : "other-printer"
            : "other-app",
      plate: null,
      fix: format.kind === "prusa" ? "convert" : plan.output === "bambu" && plan.printer ? "retarget" : "retag",
    });
  }
  const zip = plan ? (await adapt3mf(source, plan, { printer: target.recipe })).zip : source;
  const pkg = await readBambuPackage(zip);
  if (!pkg.config) {
    issues.length = 0;
    if (checks.has("project")) issues.push({ check: "project", problem: "not-a-project", plate: null, fix: null });
    return done(null);
  }
  const settings: Settings = { ...pkg.config };

  const nozzle = String(target.recipe.nozzle);
  const noVariant = !String(firstValue(settings.printer_variant) ?? "").trim();
  const noDiameter = nozzleOf(settings.nozzle_diameter) === null;
  if (checks.has("nozzle") && (noVariant || noDiameter)) {
    issues.push({ check: "nozzle", problem: "no-nozzle", plate: null, fix: "set-nozzle" });
    if (noVariant) settings.printer_variant = nozzle;
    if (noDiameter) settings.nozzle_diameter = Array.from({ length: target.recipe.extruders }, () => nozzle);
    changed = true;
  }

  const layout = await readLayout(pkg, target.recipe.bed);
  if (!layout.plates.some((plate) => plate.items.length)) {
    issues.length = 0;
    issues.push({ check: "project", problem: "unreadable", plate: null, fix: null });
    return done(null);
  }
  const rootXml = await pkg.root.entry.async("string");
  const sideFiles: Record<string, string> = {};
  for (const name of SIDE_FILES) {
    const rec = pkg.filesByKey[name.toLowerCase()];
    if (rec) sideFiles[rec.relativePath] = await rec.entry.async("string");
  }
  const sidePlaces = sideFilePlaces(sideFiles);
  const merges: LayoutItem[][] = [];

  layout.plates.forEach((plate, p) => {
    const number = p + 1;
    if (checks.has("overlapping-objects"))
      for (const group of overlappingGroups(plate)) {
        const loses = mergeLoses(group, pkg.modelSettings, rootXml, sidePlaces);
        const tooTall = layout.height !== null && mergedTop(group) > layout.height + EDGE;
        issues.push({
          check: "overlapping-objects",
          problem: "overlapping-objects",
          plate: number,
          objects: group.map((item) => item.name),
          fix: loses || tooTall ? null : "merge-objects",
        });
        if (tooTall && checks.has("off-bed"))
          issues.push({
            check: "off-bed",
            problem: "off-bed",
            plate: number,
            objects: group.map((item) => item.name),
            fix: null,
          });
        if (!loses && !tooTall) merges.push(group);
      }

    if (checks.has("off-bed")) {
      const { bed, height } = layout;
      const off = plate.items.filter(
        (item) =>
          item.bounds.min[0] < bed.minX - EDGE ||
          item.bounds.min[1] < bed.minY - EDGE ||
          item.bounds.max[0] > bed.maxX + EDGE ||
          item.bounds.max[1] > bed.maxY + EDGE ||
          (height !== null && printedHeights(item)[1] > height + EDGE),
      );
      const blocked = plate.items.filter(
        (item) => !off.includes(item) && layout.exclude.some((area) => onArea(item, plate.origin, area)),
      );
      if (off.length || blocked.length)
        issues.push({
          check: "off-bed",
          problem: "off-bed",
          plate: number,
          objects: [...off, ...blocked].map((item) => item.name),
          fix: null,
        });
    }
  });

  if (checks.has("wipe-tower") && towerEnabled(settings)) {
    const sizing = towerSettings(settings);
    const xs = asArray(settings.wipe_tower_x).map(String);
    const ys = asArray(settings.wipe_tower_y).map(String);
    let moved = false;
    layout.plates.forEach((plate, p) => {
      const [x, y] = [Number(xs[p]), Number(ys[p])];
      const placed = xs[p] !== undefined && ys[p] !== undefined && Number.isFinite(x) && Number.isFinite(y);
      if (placed && filamentsOn(plate) < 2) return;
      const tower = towerPlate(plate, layout);
      const needed = tower.filaments >= 2 && (!placed || !towerClear(tower, layout.bed, sizing, x, y));
      if (!needed && placed) return;
      // A plate without a position of its own would take the first plate's, so each gets one.
      const { spot, clear } = placeTower({ ...tower, filaments: Math.max(tower.filaments, 2) }, layout.bed, sizing);
      xs[p] = String(Math.round(spot[0] * 1000) / 1000);
      ys[p] = String(Math.round(spot[1] * 1000) / 1000);
      if (!needed) return;
      issues.push({
        check: "wipe-tower",
        problem: placed ? "tower-in-the-way" : "no-tower-position",
        plate: p + 1,
        // Nowhere on the plate keeps it clear: the plate needs room made for it.
        fix: clear ? "place-tower" : null,
      });
      moved = true;
    });
    if (moved) {
      settings.wipe_tower_x = xs;
      settings.wipe_tower_y = ys;
      changed = true;
    }
  }

  // Only what Thingport can fix makes a copy: with anything left for the slicer, the copy wouldn't be taken either.
  if (issues.some((issue) => issue.fix === null)) return done(printer);
  if (merges.length) {
    const modelSettings = pkg.filesByKey["metadata/model_settings.config"];
    const merged = mergeObjects(
      { rootXml, modelSettingsXml: modelSettings ? await modelSettings.entry.async("string") : null, sideFiles },
      merges,
    );
    zip.file(pkg.root.relativePath, merged.rootXml);
    if (modelSettings && merged.modelSettingsXml !== null)
      zip.file(modelSettings.relativePath, merged.modelSettingsXml);
    for (const [name, text] of Object.entries(merged.sideFiles)) zip.file(name, text);
    changed = true;
  }
  if (!changed) return done(printer);
  const settingsEntry = pkg.filesByKey["metadata/project_settings.config"];
  zip.file(settingsEntry?.relativePath ?? "Metadata/project_settings.config", JSON.stringify(settings, null, 4));
  return { result: { printer, needsPrinter: false, issues }, zip };
}
