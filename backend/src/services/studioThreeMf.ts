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
import { bedCentre, plateColumns, plateOrigin, type BedBox, type PrinterRecipe } from "../adapter/printer";
import { formatTransform } from "../adapter/transform";
import { contentTypesXml, relsXml } from "../adapter/writers/flatten";
import { escapeXml } from "../adapter/xml";
import type { StudioPlate } from "../studio/document.generated";
import type { EvaluatedBody } from "../studio/geometry.generated";

export type StudioExportTarget = {
  slicer: string;
  printer?: { choice: PrinterChoice; recipe: PrinterRecipe };
};

type Part = { body: EvaluatedBody; name: string; plateId: string; color?: string };
const DEFAULT_BED: BedBox = { minX: 0, minY: 0, maxX: 256, maxY: 256 };
const DEFAULT_COLOR = "#B0B0B0";
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

export async function writeStudioThreeMf(
  name: string,
  parts: Part[],
  plates: readonly StudioPlate[],
  target?: StudioExportTarget,
): Promise<Uint8Array> {
  const used = plates.filter((plate) => parts.some((part) => part.plateId === plate.id));
  const recipe = target?.printer?.recipe;
  const bed = recipe?.bed ?? DEFAULT_BED;
  const [cx, cy] = bedCentre(bed);
  const columns = plateColumns(used.length);
  const colors = [...new Set(parts.map((part) => part.color?.toUpperCase() ?? DEFAULT_COLOR))];
  const instances = used.map(() => [] as string[]);
  const objects: string[] = [];
  const build: string[] = [];
  const settings: string[] = [];
  const relationships: string[] = [];
  const zip = new JSZip();
  const add = (path: string, data: string) => zip.file(path, data, { createFolders: false });

  parts.forEach((part, index) => {
    const id = index * 3 + 1;
    const childId = id + 1;
    const file = `/3D/Objects/object_${id}.model`;
    const slot = colors.indexOf(part.color?.toUpperCase() ?? DEFAULT_COLOR) + 1;
    const plate = used.findIndex((entry) => entry.id === part.plateId);
    const [px, py] = plateOrigin(plate, columns, bed);
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
    "<config>",
    ...settings,
    ...used.map((plate, i) =>
      [
        "<plate>",
        meta("plater_id", i + 1),
        meta("plater_name", plate.name),
        meta("locked", "false"),
        ...instances[i],
        "</plate>",
      ].join("\n"),
    ),
    "</config>",
  ].join("\n");
  const projectSettings = JSON.stringify({
    printable_area: [
      `${bed.minX}x${bed.minY}`,
      `${bed.maxX}x${bed.minY}`,
      `${bed.maxX}x${bed.maxY}`,
      `${bed.minX}x${bed.maxY}`,
    ],
    printable_height: String(recipe?.height ?? 256),
    printer_settings_id: "",
    print_settings_id: "",
    nozzle_diameter: Array.from({ length: recipe?.extruders || 1 }, () => String(recipe?.nozzle ?? 0.4)),
    filament_colour: colors,
    filament_type: colors.map(() => "PLA"),
    filament_is_support: colors.map(() => "0"),
    filament_diameter: colors.map(() => "1.75"),
    filament_minimal_purge_on_wipe_tower: colors.map(() => "15"),
    filament_settings_id: colors.map(() => "Generic PLA"),
    curr_bed_type: "Textured PEI Plate",
  });
  add("[Content_Types].xml", contentTypesXml());
  add("_rels/.rels", relsXml(false));
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

  const format = classify3mf({
    entries: Object.keys(zip.files),
    modelHead: model.slice(0, 4096),
    projectSettings,
    modelSettings,
    prusaConfig: null,
  });
  const plan = target && planAdaptation(format, slicerProfile(target.slicer), target.printer?.choice);
  const result = plan ? (await adapt3mf(zip, plan, { printer: target.printer?.recipe })).zip : zip;
  return result.generateAsync({ type: "uint8array", ...ADAPT_ZIP_OPTIONS });
}
