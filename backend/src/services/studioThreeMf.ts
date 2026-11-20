import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import {
  ADAPT_ZIP_OPTIONS,
  adapt3mf,
  classify3mf,
  planAdaptation,
  slicerProfile,
  type PrinterChoice,
} from "../adapter";
import { COMPATIBLE_TAG } from "../adapter/plan";
import {
  bedBoxOf,
  bedCentre,
  plateColumns,
  plateOrigin,
  rectangle,
  type BedBox,
  type PrinterRecipe,
} from "../adapter/printer";
import { formatTransform } from "../adapter/transform";
import { contentTypesXml, relsXml } from "../adapter/writers/flatten";
import { escapeXml } from "../adapter/xml";
import {
  STUDIO_DEFAULT_BODY_COLOR,
  STUDIO_FILAMENT_SLOT_LIMIT,
  type StudioFilamentSlot,
  type StudioPlate,
  type StudioPrintSetup,
  type Vec3,
} from "../studio/document.generated";
import type { EvaluatedBody } from "../studio/geometry.generated";
import { bedOutline } from "../studio/printLayout.generated";
import { plateThumbEntry } from "./printProfileFile";

export type StudioExportTarget = {
  slicer: string;
  printer?: { choice: PrinterChoice; recipe: PrinterRecipe; outline?: StudioPrintSetup["outline"] };
  filamentSlots?: StudioFilamentSlot[];
};

type Part = { body: EvaluatedBody; name: string; plateId: string; color?: string };
const DEFAULT_BED: BedBox = { minX: 0, minY: 0, maxX: 256, maxY: 256 };
export const STUDIO_3MF_DEFAULT_COLOR = STUDIO_DEFAULT_BODY_COLOR.toUpperCase();
const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const CORE = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
const NS = 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
const BAMBU = 'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"';
const META = '<metadata name="BambuStudio:3mfVersion">1</metadata>';
const IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0";
const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const meta = (key: string, value: string | number) => `<metadata key="${key}" value="${escapeXml(String(value))}"/>`;
const number = (value: number) => String(Number(value.toFixed(7)));

function objectModel(part: Part, id: number) {
  const { positions, indices } = part.body.mesh;
  const lines = [
    XML,
    `<model unit="millimeter" ${CORE} ${NS} ${BAMBU}
    xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">`,
    META,
    "<resources>",
  ];
  const propertyId = id + 1;
  if (part.color)
    lines.push(`<m:colorgroup id="${propertyId}"><m:color color="${part.color.toUpperCase()}FF"/></m:colorgroup>`);
  const properties = part.color ? ` pid="${propertyId}" pindex="0"` : "";
  lines.push(
    `<object id="${id}" p:UUID="${randomUUID()}" name="${escapeXml(part.name)}" type="model"${properties}><mesh><vertices>`,
  );
  for (let i = 0; i < positions.length; i += 3)
    lines.push(`<vertex x="${number(positions[i])}" y="${number(positions[i + 1])}" z="${number(positions[i + 2])}"/>`);
  lines.push("</vertices><triangles>");
  for (let i = 0; i < indices.length; i += 3)
    lines.push(`<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`);
  lines.push("</triangles></mesh></object></resources><build/></model>");
  return lines.join("\n");
}

export function studioThreeMfBed(target?: StudioExportTarget, setup?: StudioPrintSetup) {
  const recipe = target?.printer?.recipe;
  const bed = recipe?.bed ?? (setup ? { minX: 0, minY: 0, maxX: setup.bed[0], maxY: setup.bed[1] } : DEFAULT_BED);
  const size: Vec3 = [bed.maxX - bed.minX, bed.maxY - bed.minY, recipe?.height ?? setup?.bed[2] ?? 256];
  const outline = recipe?.bed ? target?.printer?.outline : setup?.outline;
  return { bed, size, outline };
}

export async function writeStudioThreeMf(
  name: string,
  parts: Part[],
  plates: readonly (StudioPlate & { thumbnail: Uint8Array })[],
  target?: StudioExportTarget,
  setup?: StudioPrintSetup,
): Promise<Uint8Array | null> {
  const profile = target ? slicerProfile(target.slicer) : null;
  const recipe = target?.printer?.recipe;
  const { bed, size, outline } = studioThreeMfBed(target, setup);
  const height = size[2];
  const [cx, cy] = bedCentre(bed);
  const printableArea =
    recipe?.bed && !recipe.bed.outline
      ? rectangle(recipe.bed)
      : bedOutline(size, outline).map(([x, y]) => `${number(x + cx)}x${number(y + cy)}`);
  const layoutBed = bedBoxOf(printableArea) ?? bed;
  const [layoutX, layoutY] = bedCentre(layoutBed);
  // Spacing follows the printable area. An off-center outline still shares the design's original XY origin.
  const centerOffset = [number(cx - layoutX), number(cy - layoutY)];
  const originAttribute = centerOffset.some((offset) => offset !== "0")
    ? ` thingport_bed_center_offset="${centerOffset.join(" ")}"`
    : "";
  const columns = plateColumns(plates.length);
  const colorOf = (part: Part) => part.color?.toLowerCase() ?? STUDIO_DEFAULT_BODY_COLOR;
  const usedColors = new Set(parts.map(colorOf));
  if (profile?.reads === "bambu" && usedColors.size > STUDIO_FILAMENT_SLOT_LIMIT) return null;
  const byColor = new Map<string, number>();
  const palette: ({ color: string; material: string } | undefined)[] = [];
  for (const { color, slot, material } of target?.filamentSlots ?? []) {
    if (!usedColors.has(color)) continue;
    palette[slot - 1] = { color, material };
    byColor.set(color, slot);
  }
  let nextSlot = 0;
  for (const color of usedColors) {
    if (byColor.has(color)) continue;
    while (palette[nextSlot]) nextSlot++;
    palette[nextSlot] = { color, material: "PLA" };
    byColor.set(color, nextSlot + 1);
  }
  const slots = Array.from(palette, (entry) => entry ?? { color: STUDIO_DEFAULT_BODY_COLOR, material: "PLA" });
  const instances = plates.map(() => [] as string[]);
  const objects: string[] = [];
  const build: string[] = [];
  const settings: string[] = [];
  const relationships: string[] = [];
  const zip = new JSZip();
  const add = (path: string, data: string | Uint8Array) => zip.file(path, data, { createFolders: false });

  parts.forEach((part, index) => {
    const id = index * 3 + 1;
    const childId = id + 1;
    const file = `/3D/Objects/object_${id}.model`;
    const slot = byColor.get(colorOf(part))!;
    const plate = plates.findIndex((entry) => entry.id === part.plateId);
    const [px, py] = plateOrigin(plate, columns, layoutBed);
    const m = part.body.matrix;
    const transform = formatTransform([
      m[0],
      m[1],
      m[2],
      m[4],
      m[5],
      m[6],
      m[8],
      m[9],
      m[10],
      m[12] + cx + px,
      m[13] + cy + py,
      m[14],
    ]);
    add(file.slice(1), objectModel(part, childId));
    relationships.push(`<Relationship Target="${file}" Id="rel-${id}" Type="${MODEL_REL}"/>`);
    objects.push(`<object id="${id}" p:UUID="${randomUUID()}" type="model"><components>
      <component p:path="${file}" objectid="${childId}" p:UUID="${randomUUID()}" transform="${IDENTITY}"/>
      </components></object>`);
    build.push(`<item objectid="${id}" p:UUID="${randomUUID()}" transform="${transform}" printable="1"/>`);
    settings.push(`<object id="${id}">${meta("name", part.name)}${meta("extruder", slot)}
      <part id="${childId}" subtype="normal_part">${meta("name", part.name)}${meta("extruder", slot)}
      ${meta("matrix", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1")}</part></object>`);
    instances[plate].push(`<model_instance>${meta("object_id", id)}${meta("instance_id", 0)}
      ${meta("identify_id", index + 1000)}</model_instance>`);
  });

  const model = [
    XML,
    `<model unit="millimeter" xml:lang="en-US" ${CORE} ${NS} ${BAMBU} requiredextensions="p">`,
    `<metadata name="Title">${escapeXml(name)}</metadata>`,
    `<metadata name="Application">${COMPATIBLE_TAG}</metadata>`,
    META,
    "<resources>",
    ...objects,
    "</resources>",
    `<build p:UUID="${randomUUID()}">`,
    ...build,
    "</build></model>",
  ].join("\n");
  const modelSettings = [
    XML,
    `<config${originAttribute}>`,
    ...settings,
    ...plates.map((plate, i) =>
      [
        "<plate>",
        meta("plater_id", i + 1),
        meta("plater_name", plate.name),
        meta("thumbnail_file", plateThumbEntry(i + 1)),
        meta("locked", "false"),
        ...instances[i],
        "</plate>",
      ].join("\n"),
    ),
    "</config>",
  ].join("\n");
  const projectSettings = JSON.stringify({
    printable_area: printableArea,
    printable_height: String(height),
    printer_settings_id: "",
    print_settings_id: "",
    nozzle_diameter: Array.from({ length: recipe?.extruders || 1 }, () => String(recipe?.nozzle ?? 0.4)),
    filament_colour: slots.map(({ color }) => color.toUpperCase()),
    filament_type: slots.map(({ material }) => material),
    filament_is_support: slots.map(() => "0"),
    filament_diameter: slots.map(() => "1.75"),
    filament_minimal_purge_on_wipe_tower: slots.map(() => "15"),
    filament_settings_id: slots.map(({ material }) => `Generic ${material}`),
    curr_bed_type: "Textured PEI Plate",
  });
  add("[Content_Types].xml", contentTypesXml());
  add("_rels/.rels", relsXml(true, `/${plateThumbEntry(1)}`));
  add("3D/3dmodel.model", model);
  add(
    "3D/_rels/3dmodel.model.rels",
    [
      XML,
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ...relationships,
      "</Relationships>",
    ].join("\n"),
  );
  add("Metadata/model_settings.config", modelSettings);
  add("Metadata/project_settings.config", projectSettings);
  plates.forEach((plate, i) => add(plateThumbEntry(i + 1), plate.thumbnail));

  const format = classify3mf({
    entries: Object.keys(zip.files),
    modelHead: model.slice(0, 4096),
    projectSettings,
    modelSettings,
    prusaConfig: null,
  });
  const plan = target && planAdaptation(format, profile, target.printer?.choice);
  const printer = recipe?.bed ? { ...recipe, bed: { ...layoutBed, outline: recipe.bed.outline } } : recipe;
  const result = plan ? (await adapt3mf(zip, plan, { printer })).zip : zip;
  return result.generateAsync({ type: "uint8array", ...ADAPT_ZIP_OPTIONS });
}
