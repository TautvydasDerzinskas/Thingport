// GENERATED from backend/src/adapter/writers/bambuFromPrusa.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A PrusaSlicer project as Bambu Studio and the slicers built on it save their own: each object's parts as objects of
// their own (3D/Objects), what each part is and the settings changed for it in model_settings.config, the painting
// under Bambu's names, and its beds as plates. Those slicers open a PrusaSlicer project with an old loader that keeps
// the parts but drops every setting, the colours and the beds, and refuses painting of a 17th filament or later
// (PrusaSlicer 2.9.6's MmPaintingVersion 2).
//
// Without a printer the copy has no project settings, so the slicer keeps the user's own presets: the designer's
// settings go on each object instead. For a printer (printer.ts) it's a project naming that printer's presets, the
// designer's settings listed as changes to its process, with their colours and plates moved onto its bed.

import JSZip from "jszip";
import { COMPATIBLE_TAG, type AdaptPlan } from "../plan.generated";
import {
  bedBoxOf,
  bedCentre,
  chooseFilament,
  chooseProcess,
  moveWipeTowers,
  plateColumns,
  plateOrigin,
  rectangle,
  SLICER_DEFAULT_COLOUR,
  type BedBox,
  type PrinterRecipe,
} from "../printer.generated";
import { prusaPaintToBambu } from "../paint.generated";
import { prusaList, type PrusaObject, type PrusaPackage } from "../readers/prusaProject.generated";
import {
  bambuRegionSettings,
  bambuSettingsFromPrusa,
  type Settings,
  type SettingsDialect,
} from "../settings.generated";
import { composeTransform, formatTransform, IDENTITY, parseTransform } from "../transform.generated";
import { escapeXml, parseAttrs } from "../xml.generated";
import { contentTypesXml, relsXml } from "./flatten.generated";
import type { Written } from "./types.generated";

type BambuPlan = Extract<AdaptPlan, { output: "bambu" }>;

const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const NAMESPACES =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';
const MATRIX_IDENTITY = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";

// PrusaSlicer's names for painting, as Bambu's.
const PAINT_NAMES: Record<string, string> = {
  "slic3rpe:mmu_segmentation": "paint_color",
  paint_color: "paint_color",
  "slic3rpe:custom_supports": "paint_supports",
  "slic3rpe:custom_seam": "paint_seam",
  "slic3rpe:fuzzy_skin": "paint_fuzzy_skin",
};

// The model metadata worth keeping: what the model is and who made it, not which app.
const KEPT_METADATA = new Set(["Title", "Designer", "Description", "Copyright", "LicenseTerms", "CreationDate"]);

// The project-wide settings worth carrying: the design's choices. PrusaSlicer saves every setting, and the rest are
// its printer's profile, which the user's own (or the printer's preset) knows better. What the designer set on an
// object or a part is carried whole.
const DESIGN_KEYS = [
  "layer_height",
  "wall_loops",
  "top_shell_layers",
  "bottom_shell_layers",
  "sparse_infill_density",
  "sparse_infill_pattern",
  "enable_support",
  "support_type",
  "support_style",
  "support_threshold_angle",
  "support_on_build_plate_only",
  "brim_type",
  "brim_width",
  "raft_layers",
  "ironing_type",
  "fuzzy_skin",
];
const SUPPORT_KEYS = ["support_type", "support_style", "support_threshold_angle", "support_on_build_plate_only"];

/** The design's choices among a project's settings. What's off is left to the user's profile: PrusaSlicer's off is
 *  its default (it has no automatic brim, Bambu's default), not a choice. */
function designChoices(settings: Record<string, string>): Record<string, string> {
  const out = Object.fromEntries(DESIGN_KEYS.filter((key) => key in settings).map((key) => [key, settings[key]]));
  if (out.enable_support !== "1") for (const key of ["enable_support", ...SUPPORT_KEYS]) delete out[key];
  // 0 is PrusaSlicer's automatic threshold.
  if (out.support_threshold_angle === "0") delete out.support_threshold_angle;
  if (out.brim_type === "no_brim") {
    delete out.brim_type;
    delete out.brim_width;
  }
  if (out.raft_layers === "0") delete out.raft_layers;
  if (out.ironing_type === "no ironing") delete out.ironing_type;
  if (out.fuzzy_skin === "none") delete out.fuzzy_skin;
  return out;
}

// PrusaSlicer projects don't name a build plate, and the slicers would take Cool Plate, which PETG and ABS presets
// refuse. This is the one Bambu Lab's printer profiles start with (default_bed_type), with a temperature in every
// filament preset.
const PLATE = "Textured PEI Plate";

// PrusaSlicer's filament types where the Bambu family names them apart.
const FILAMENT_TYPES: Record<string, string> = { FLEX: "TPU" };

/** Bambu-style UUIDs, made up but the same each time for the same id. */
const uuid = (id: number, tail: string) => `${id.toString(16).padStart(8, "0")}-${tail}`;

type Mesh = { x: string[]; y: string[]; z: string[]; triangles: Int32Array; paint: Map<number, string> };

/** An object's mesh: its vertices as written, its triangles' corners, and each painted triangle's painting. */
function readMesh(body: string, transcodeColours: boolean): Mesh {
  const x: string[] = [];
  const y: string[] = [];
  const z: string[] = [];
  const vertexRe = /<vertex\b([^>]*?)\/?>/gi;
  let m;
  while ((m = vertexRe.exec(body))) {
    const a = parseAttrs(m[1]);
    x.push(a.x ?? "0");
    y.push(a.y ?? "0");
    z.push(a.z ?? "0");
  }
  const corners: number[] = [];
  const paint = new Map<number, string>();
  const triangleRe = /<triangle\b([^>]*?)\/?>/gi;
  while ((m = triangleRe.exec(body))) {
    const a = parseAttrs(m[1]);
    const index = corners.length / 3;
    corners.push(Number.parseInt(a.v1, 10), Number.parseInt(a.v2, 10), Number.parseInt(a.v3, 10));
    let painted = "";
    for (const [name, value] of Object.entries(a)) {
      const bambuName = PAINT_NAMES[name];
      if (!bambuName || !value || painted.includes(`${bambuName}=`)) continue;
      const code = bambuName === "paint_color" && transcodeColours ? prusaPaintToBambu(value) : value;
      painted += ` ${bambuName}="${escapeXml(code)}"`;
    }
    if (painted) paint.set(index, painted);
  }
  return { x, y, z, triangles: Int32Array.from(corners), paint };
}

/** The triangles `first` to `last` as a mesh object of their own, using only their vertices. */
function partObjectXml(mesh: Mesh, first: number, last: number, id: number): string | null {
  const count = mesh.triangles.length / 3;
  const from = Math.max(first, 0);
  const to = Math.min(last, count - 1);
  if (to < from) return null;
  const remap = new Map<number, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  const vertex = (index: number) => {
    let mapped = remap.get(index);
    if (mapped === undefined) {
      mapped = vertices.length;
      remap.set(index, mapped);
      vertices.push(
        `     <vertex x="${mesh.x[index] ?? "0"}" y="${mesh.y[index] ?? "0"}" z="${mesh.z[index] ?? "0"}"/>`,
      );
    }
    return mapped;
  };
  for (let t = from; t <= to; t++) {
    const v1 = vertex(mesh.triangles[t * 3]);
    const v2 = vertex(mesh.triangles[t * 3 + 1]);
    const v3 = vertex(mesh.triangles[t * 3 + 2]);
    triangles.push(`     <triangle v1="${v1}" v2="${v2}" v3="${v3}"${mesh.paint.get(t) ?? ""}/>`);
  }
  return [
    `  <object id="${id}" p:UUID="${uuid(id, "81cb-4c03-9d28-80fed5dfa1dc")}" type="model">`,
    "   <mesh>",
    "    <vertices>",
    ...vertices,
    "    </vertices>",
    "    <triangles>",
    ...triangles,
    "    </triangles>",
    "   </mesh>",
    "  </object>",
  ].join("\n");
}

function metadataXml(entries: Record<string, string>, indent: string): string[] {
  return Object.entries(entries).map(
    ([key, value]) => `${indent}<metadata key="${escapeXml(key)}" value="${escapeXml(value)}"/>`,
  );
}

// PrusaSlicer 2.9 lays its beds out around the first, in this order (MultipleBeds.cpp index2grid_coords).
const BED_GRID: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

function versionAtLeast(version: string | undefined, major: number, minor: number): boolean {
  const m = /(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a > major || (a === major && b >= minor);
}

/** Where a project's bed `index` is, as PrusaSlicer places it: 2.9 and later in a grid a gap apart (the smaller of
 *  100 mm and 0.3 of the bed's diagonal, MultipleBeds::bed_gap), earlier ones in a row a fifth of a bed apart. */
function prusaBedOffset(index: number, bed: BedBox, grid: boolean): [number, number] {
  const width = bed.maxX - bed.minX;
  const depth = bed.maxY - bed.minY;
  if (!grid) return [index * width * 1.2, 0];
  const gap = Math.min(100, Math.hypot(width, depth) * 0.3);
  const [col, row] = BED_GRID[index] ?? [0, 0];
  return [col * (width + gap), row * (depth + gap)];
}

/** The bed an object stands on, by where its origin is; the first when it's on none. */
function prusaBedOf(x: number, y: number, bed: BedBox, grid: boolean): number {
  const width = bed.maxX - bed.minX;
  const depth = bed.maxY - bed.minY;
  const slack = grid ? Math.min(100, Math.hypot(width, depth) * 0.3) / 2 : width * 0.1;
  for (let index = 0; index < (grid ? BED_GRID.length : 64); index++) {
    const [ox, oy] = prusaBedOffset(index, bed, grid);
    const inX = x >= bed.minX + ox - slack && x <= bed.maxX + ox + slack;
    const inY = y >= bed.minY + oy - slack && y <= bed.maxY + oy + slack;
    if (inX && inY) return index;
  }
  return 0;
}

function prusaBed(config: Record<string, string>): BedBox | null {
  return bedBoxOf(prusaList(config.bed_shape).flatMap((point) => point.split(",")));
}

/** Settings without a layer height above the printer's nozzle, which the slicer refuses (Print::validate): the
 *  process nearest it sets the height instead. */
function withinNozzle(settings: Record<string, string>, recipe: PrinterRecipe | null): Record<string, string> {
  if (!recipe || !(Number(settings.layer_height) > recipe.nozzle)) return settings;
  const { layer_height: _height, ...rest } = settings;
  return rest;
}

// A PrusaSlicer filament's own temperatures, fans and flow, by Bambu's names. For a filament the printer has no preset
// of its type for, the slicer makes one of the file's values, so these are the designer's rather than its default
// filament's.
const FILAMENT_SETTINGS: [string, string[]][] = [
  ["temperature", ["nozzle_temperature"]],
  ["first_layer_temperature", ["nozzle_temperature_initial_layer"]],
  ["bed_temperature", ["hot_plate_temp", "textured_plate_temp"]],
  ["first_layer_bed_temperature", ["hot_plate_temp_initial_layer", "textured_plate_temp_initial_layer"]],
  ["min_fan_speed", ["fan_min_speed"]],
  ["max_fan_speed", ["fan_max_speed"]],
  ["filament_max_volumetric_speed", ["filament_max_volumetric_speed"]],
  ["extrusion_multiplier", ["filament_flow_ratio"]],
  ["filament_diameter", ["filament_diameter"]],
  ["filament_density", ["filament_density"]],
];

/** The project's filaments' own settings, a value for each of `count`: PrusaSlicer lists numbers with commas. */
function filamentSettings(config: Record<string, string>, count: number): Settings {
  const out: Settings = {};
  for (const [key, bambuKeys] of FILAMENT_SETTINGS) {
    const list = String(config[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!list.length) continue;
    const values = Array.from({ length: count }, (_, i) => nthOrLast(list, i));
    for (const bambuKey of bambuKeys) out[bambuKey] = values;
  }
  return out;
}

/** Each bed's wipe tower, by bed: PrusaSlicer 2.9 keeps them in a file of its own (3mf.cpp
 *  WIPE_TOWER_INFORMATION_FILE), in each bed's own coordinates. */
async function wipeTowersByBed(pkg: PrusaPackage): Promise<Map<number, [string, string]>> {
  const towers = new Map<number, [string, string]>();
  const file = pkg.filesByKey["metadata/prusa_slicer_wipe_tower_information.xml"];
  if (!file) return towers;
  const xml = await file.entry.async("string");
  for (const m of xml.matchAll(/<wipe_tower_information\b([^>]*?)\/?>/gi)) {
    const a = parseAttrs(m[1]);
    const bed = Number.parseInt(a.bed_idx ?? "0", 10);
    if (Number.isInteger(bed) && a.position_x !== undefined && a.position_y !== undefined)
      towers.set(bed, [a.position_x, a.position_y]);
  }
  return towers;
}

/** A list's value for filament `i`, its last for one past its end. */
const nthOrLast = (list: string[], i: number) => list[i] || list[list.length - 1] || "";

/** The project's filaments as a slicer of the Bambu family lists them: a colour, type and preset each. */
function filamentsOf(config: Record<string, string>, used: number) {
  const extruderColours = prusaList(config.extruder_colour);
  const filamentColours = prusaList(config.filament_colour);
  const types = prusaList(config.filament_type);
  const names = prusaList(config.filament_settings_id);
  const count = Math.max(filamentColours.length, extruderColours.length, types.length, names.length, used, 1);
  // PrusaSlicer shows an extruder's own colour where it has one, else its filament's.
  const colours = Array.from({ length: count }, (_, i) => {
    const colour = (extruderColours[i] || filamentColours[i] || "").trim();
    return /^#[0-9a-f]{6}$/i.test(colour) ? colour.toUpperCase() : SLICER_DEFAULT_COLOUR;
  });
  return {
    count,
    colours,
    types: Array.from({ length: count }, (_, i) => {
      const type = nthOrLast(types, i) || "PLA";
      return FILAMENT_TYPES[type.toUpperCase()] ?? type;
    }),
    names: Array.from({ length: count }, (_, i) => nthOrLast(names, i)),
  };
}

export async function writeBambuFromPrusa(
  pkg: PrusaPackage,
  plan: BambuPlan,
  recipe?: PrinterRecipe | null,
): Promise<Written> {
  const dialect: SettingsDialect = plan.dialect ?? "bambu";
  const target = plan.printer && recipe ? recipe : null;
  const config = pkg.config;
  // PrusaSlicer prints what's set on an extruder the project hasn't with the first (clamp_exturder_to_default). It has
  // one per nozzle diameter, a list of numbers.
  const extruders = String(config.nozzle_diameter ?? "")
    .split(",")
    .filter((d) => d.trim()).length;
  const onExtruder = (n: number) => (extruders && n > extruders ? 1 : n);
  const globals = withinNozzle(designChoices(bambuSettingsFromPrusa(config, dialect)), target);
  const transcodeColours = Number(pkg.metadata["slic3rpe:MmPaintingVersion"] ?? "1") >= 2;
  const grid = !/^(PrusaSlicer|Slic3r)/i.test(pkg.metadata.Application ?? "")
    ? false
    : versionAtLeast(pkg.metadata.Application?.split("-")[1], 2, 9);

  const out = new JSZip();
  // Without folder entries, as Bambu Studio writes them.
  const add = (name: string, data: string | Uint8Array) => out.file(name, data, { createFolders: false });
  const objectFiles: string[] = [];
  const rootObjects: string[] = [];
  const settingsObjects: string[] = [];
  const parentOf = new Map<string, number>();
  let nextId = 1;
  let maxExtruder = 1;
  let objectSettings = 0;

  for (const source of pkg.model.objects) {
    if (!source.hasMesh) continue;
    const mesh = readMesh(source.body, transcodeColours);
    const triangleCount = mesh.triangles.length / 3;
    if (!triangleCount) continue;
    const info: PrusaObject = pkg.objects[source.id] ?? {
      id: source.id,
      name: "",
      extruder: 0,
      settings: {},
      volumes: [],
    };
    const volumes = info.volumes.length
      ? info.volumes
      : [
          {
            first: 0,
            last: triangleCount - 1,
            name: info.name,
            role: "normal_part" as const,
            extruder: 0,
            settings: {},
          },
        ];
    const objectExtruder = onExtruder(info.extruder || 1);
    const parts: { id: number; xml: string; volume: (typeof volumes)[number] }[] = [];
    for (const volume of volumes) {
      const id = nextId;
      const xml = partObjectXml(mesh, volume.first, volume.last, id);
      if (!xml) continue;
      nextId++;
      parts.push({ id, xml, volume });
    }
    if (!parts.length) continue;
    const parentId = nextId++;
    parentOf.set(source.id, parentId);
    const file = `3D/Objects/object_${parentId}.model`;
    objectFiles.push(file);
    add(
      file,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<model unit="millimeter" xml:lang="en-US" ${NAMESPACES}>`,
        ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
        " <resources>",
        ...parts.map((part) => part.xml),
        " </resources>",
        " <build/>",
        "</model>",
        "",
      ].join("\n"),
    );
    rootObjects.push(
      [
        `  <object id="${parentId}" p:UUID="${uuid(parentId, "61cb-4c03-9d28-80fed5dfa1dc")}" type="model">`,
        "   <components>",
        ...parts.map(
          (part) =>
            `    <component p:path="/${file}" objectid="${part.id}" p:UUID="${uuid(part.id, "b206-40ff-9872-83e8017abed1")}" transform="${IDENTITY}"/>`,
        ),
        "   </components>",
        "  </object>",
      ].join("\n"),
    );
    // Without project settings, the project's own settings go on each object, under its own.
    const own = withinNozzle(bambuSettingsFromPrusa(info.settings, dialect), target);
    const objectValues = target ? own : { ...globals, ...own };
    objectSettings += Object.keys(objectValues).length;
    const name = info.name || parts[0].volume.name || `Object ${parentId}`;
    settingsObjects.push(
      [
        `  <object id="${parentId}">`,
        ...metadataXml({ name, extruder: String(objectExtruder), ...objectValues }, "    "),
        ...parts.flatMap(({ id, volume }) => {
          const extruder = onExtruder(volume.extruder) || objectExtruder;
          maxExtruder = Math.max(maxExtruder, extruder);
          const values = bambuRegionSettings(bambuSettingsFromPrusa(volume.settings, dialect));
          objectSettings += Object.keys(values).length;
          const meta = Object.assign(
            { name: volume.name || name, matrix: MATRIX_IDENTITY, extruder: String(extruder) },
            values,
          );
          return [`    <part id="${id}" subtype="${volume.role}">`].concat(metadataXml(meta, "      "), "    </part>");
        }),
        "  </object>",
      ].join("\n"),
    );
    maxExtruder = Math.max(maxExtruder, objectExtruder);
  }

  // Beds as plates, each bed's objects moved from the middle of it to the middle of their plate in the slicers' own grid
  // of plates (printer.ts): on the printer's bed for a printer; without one, the slicer's isn't known and the
  // project's own stands in for it.
  const bed = prusaBed(config);
  // PrusaSlicer writes an object's later instances as objects of their own holding only its first
  // (3mf.cpp _add_object_to_model_stream): each is one more instance of that object here, placed by its build item.
  const aliasOf = new Map<string, { objectid: string; transform: string | null }>();
  for (const source of pkg.model.objects) {
    const [component] = source.components;
    if (!source.hasMesh && source.components.length === 1 && !component.path && parentOf.has(component.objectid))
      aliasOf.set(source.id, { objectid: component.objectid, transform: component.transform });
  }
  const items = pkg.model.buildItems.flatMap((item) => {
    const alias = aliasOf.get(item.objectid);
    if (!alias) return parentOf.has(item.objectid) ? [item] : [];
    const transform = formatTransform(composeTransform(item.transform, alias.transform));
    return [{ objectid: alias.objectid, transform, printable: item.printable, instanceId: item.instanceId }];
  });
  const transforms = items.map((item) => parseTransform(item.transform));
  const beds = items.map((_, i) => (bed ? prusaBedOf(transforms[i][9], transforms[i][10], bed, grid) : 0));
  const used = [...new Set(beds)].toSorted((a, b) => a - b);
  const plateOfBed = new Map(used.map((index, plate) => [index, plate]));
  const toBed = target?.bed ?? bed;
  if (toBed && bed) {
    const columns = plateColumns(used.length);
    const [fromX, fromY] = bedCentre(bed);
    const [toX, toY] = bedCentre(toBed);
    items.forEach((_, i) => {
      const [bx, by] = prusaBedOffset(beds[i], bed, grid);
      const [px, py] = plateOrigin(plateOfBed.get(beds[i]) ?? 0, columns, toBed);
      transforms[i][9] += px + toX - (bx + fromX);
      transforms[i][10] += py + toY - (by + fromY);
    });
  }
  const instances = new Map<string, number>();
  const buildItems: string[] = [];
  const plates = used.map(() => [] as string[]);
  items.forEach((item, i) => {
    const parentId = parentOf.get(item.objectid) as number;
    const instance = instances.get(item.objectid) ?? 0;
    instances.set(item.objectid, instance + 1);
    const printable = item.printable === "0" ? "0" : "1";
    buildItems.push(
      `  <item objectid="${parentId}" p:UUID="${uuid(parentId * 1000 + instance, "b1ec-4553-aec9-835e5b724bb4")}" transform="${formatTransform(transforms[i])}" printable="${printable}"/>`,
    );
    plates[plateOfBed.get(beds[i]) ?? 0].push(
      [
        "    <model_instance>",
        `      <metadata key="object_id" value="${parentId}"/>`,
        `      <metadata key="instance_id" value="${instance}"/>`,
        `      <metadata key="identify_id" value="${1000 + i}"/>`,
        "    </model_instance>",
      ].join("\n"),
    );
  });

  const head = Object.entries(pkg.metadata)
    .filter(([name]) => KEPT_METADATA.has(name))
    .map(([name, text]) => ` <metadata name="${escapeXml(name)}">${escapeXml(text)}</metadata>`);
  add(
    "3D/3dmodel.model",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<model unit="millimeter" xml:lang="en-US" ${NAMESPACES}>`,
      ` <metadata name="Application">${escapeXml(plan.tag ?? COMPATIBLE_TAG)}</metadata>`,
      ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
      ...head,
      " <resources>",
      ...rootObjects,
      " </resources>",
      ` <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">`,
      ...buildItems,
      " </build>",
      "</model>",
      "",
    ].join("\n"),
  );
  add(
    "3D/_rels/3dmodel.model.rels",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ...objectFiles.map((file, i) => ` <Relationship Target="/${file}" Id="rel-${i + 1}" Type="${MODEL_REL}"/>`),
      "</Relationships>",
      "",
    ].join("\n"),
  );
  add(
    "Metadata/model_settings.config",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<config>",
      ...settingsObjects,
      ...plates.map((instancesOnPlate, i) =>
        [
          "  <plate>",
          `    <metadata key="plater_id" value="${i + 1}"/>`,
          '    <metadata key="plater_name" value=""/>',
          '    <metadata key="locked" value="false"/>',
          ...instancesOnPlate,
          "  </plate>",
        ].join("\n"),
      ),
      "</config>",
      "",
    ].join("\n"),
  );

  let report: { process: string | null; filaments: string[] } | null = null;
  if (target) {
    const filaments = filamentsOf(config, maxExtruder);
    const diff = Array.from({ length: filaments.count + 2 }, () => "");
    diff[0] = Object.keys(globals).join(";");
    // The same product for the printer, else its preset for that material. Without one, the designer's name stays: the
    // slicer then builds a preset of the file's values, theirs below, rather than another material's.
    const chosen = filaments.names.map((name, i) =>
      chooseFilament(target, { name, inherits: "", type: filaments.types[i] }),
    );
    const presets = chosen.map((preset, i) => preset ?? filaments.names[i]);
    const layerHeight = Number(config.layer_height);
    const process = chooseProcess(
      target,
      config.print_settings_id ?? "",
      Number.isFinite(layerHeight) ? layerHeight : null,
    );
    const settings: Settings = {
      ...globals,
      printer_settings_id: target.preset,
      ...(target.model ? { printer_model: target.model } : {}),
      ...(process ? { print_settings_id: process } : {}),
      print_compatible_printers: [target.preset],
      filament_settings_id: presets,
      filament_colour: filaments.colours,
      filament_type: filaments.types,
      curr_bed_type: PLATE,
      inherits_group: Array.from({ length: filaments.count + 2 }, () => ""),
      different_settings_to_system: diff,
      ...(target.bed && !target.bed.outline ? { printable_area: rectangle(target.bed) } : {}),
      ...(target.height ? { printable_height: String(target.height) } : {}),
      ...(chosen.includes(null) ? filamentSettings(config, filaments.count) : {}),
    };
    // PrusaSlicer leaves its wipe tower on for one filament too, where it makes none.
    if (config.wipe_tower !== undefined && filaments.count > 1) {
      settings.enable_prime_tower = config.wipe_tower === "1" ? "1" : "0";
      diff[0] = [diff[0], "enable_prime_tower"].filter(Boolean).join(";");
    }
    // Each plate's from its bed's, or before 2.9, the one place in the settings.
    const saved = await wipeTowersByBed(pkg);
    const legacy: [string, string] | null =
      config.wipe_tower_x !== undefined && config.wipe_tower_y !== undefined
        ? [config.wipe_tower_x, config.wipe_tower_y]
        : null;
    const placed = used.map((index) => saved.get(index) ?? legacy);
    if (bed && target.bed && placed.every((tower) => tower !== null)) {
      const towers = moveWipeTowers(
        {
          wipe_tower_x: placed.map((tower) => tower[0]),
          wipe_tower_y: placed.map((tower) => tower[1]),
          prime_tower_width: config.wipe_tower_width,
          prime_tower_brim_width: config.wipe_tower_brim_width,
        },
        bed,
        target.bed,
      );
      if (towers) {
        settings.wipe_tower_x = towers.x;
        settings.wipe_tower_y = towers.y;
      }
    }
    add("Metadata/project_settings.config", JSON.stringify(settings, null, 4));
    report = { process, filaments: presets };
  }

  const thumbnail = pkg.filesByKey["metadata/thumbnail.png"];
  if (thumbnail) add("Metadata/thumbnail.png", await thumbnail.entry.async("uint8array"));
  add("[Content_Types].xml", contentTypesXml());
  add("_rels/.rels", relsXml(Boolean(thumbnail)));

  return {
    zip: out,
    report: () => ({
      output: "bambu",
      from: "prusa",
      retagged: true,
      droppedOrcaTag: false,
      translated: false,
      objectSettings,
      ...(report ? { printer: target?.preset ?? null, ...report } : {}),
    }),
  };
}
