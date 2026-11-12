// Reads a Bambu Studio layout 3MF (the production extension's 3D/Objects/*.model, Metadata/model_settings.config and
// project_settings.config), as Bambu Studio and the slicers built on it write one. Small files first; the meshes only
// when a writer needs them.

import JSZip from "jszip";
import { extractBambuSettings, type Settings } from "../settings";
import { decodeXml, parseAttrs, pathKey, readMetadata } from "../xml";

export const NO_MODEL = "No valid 3D model found inside the 3MF file.";

export type ZipRecord = { relativePath: string; entry: JSZip.JSZipObject };

/** What a part of an object is, by Bambu's names (its `subtype`): printed, or a volume acting on the others. */
export type PartRole = "normal_part" | "modifier_part" | "negative_part" | "support_enforcer" | "support_blocker";
const PART_ROLES = new Set<string>([
  "normal_part",
  "modifier_part",
  "negative_part",
  "support_enforcer",
  "support_blocker",
]);

// What Bambu Studio writes in a part's metadata besides the settings changed for it.
const PART_INFO_KEYS = new Set([
  "name",
  "extruder",
  "modifier",
  "volume_type",
  "part_type",
  "matrix",
  "source_file",
  "source_object_id",
  "source_volume_id",
  "source_offset_x",
  "source_offset_y",
  "source_offset_z",
  "source_in_inches",
  "source_in_meters",
  "mesh_shared",
  "uuid",
  "assembly_src_guid",
]);

export type PartSettings = {
  id?: string;
  name: string;
  extruder: number;
  role: PartRole;
  /** The settings the designer changed for this part alone, by Bambu key: a modifier's are the point of it. */
  settings: Record<string, string>;
};

// As Bambu Studio reads it: the part's subtype, unless an older file's metadata names it, and a name it doesn't know
// is a printed part.
function partRole(subtype: string | undefined, meta: Record<string, string>): PartRole {
  const name = meta.volume_type ?? meta.part_type ?? subtype;
  return name && PART_ROLES.has(name) ? (name as PartRole) : "normal_part";
}

/** An object of model_settings.config: its name, filament, parts, and the settings changed for it alone. */
export type ObjectSettings = {
  id: string;
  name: string;
  extruder: number;
  parts: PartSettings[];
  settings: Record<string, string>;
};
export type PlateInstance = { objectId: string; instanceId: number; identifyId: string };
export type PlateSettings = { id: string; name: string; instances: PlateInstance[] };

export type ModelMetadata = { attrs: Record<string, string>; text: string };
export type Component = { objectid: string; path: string | null; transform: string | null };
export type ModelObject = { id: string; body: string; hasMesh: boolean; components: Component[] };
export type SourceBuildItem = { objectid: string; transform: string | null; printable?: string; instanceId: number };
export type ParsedModel = { objects: ModelObject[]; buildItems: SourceBuildItem[]; metadata: ModelMetadata[] };

export type BambuPackage = {
  zip: JSZip;
  filesByKey: Record<string, ZipRecord>;
  root: ZipRecord;
  /** The project's settings as stored, null when there are none or they aren't JSON. */
  config: Settings | null;
  /** Those settings with the legacy nested process block merged in, {} without any. */
  settings: Settings;
  modelSettingsXml: string | null;
  modelSettings: Record<string, ObjectSettings>;
  plates: PlateSettings[];
};

export function indexZipFiles(zip: JSZip): Record<string, ZipRecord> {
  const filesByKey: Record<string, ZipRecord> = {};
  for (const [relativePath, entry] of Object.entries(zip.files)) {
    if (!entry.dir) filesByKey[pathKey(relativePath)] = { relativePath, entry };
  }
  return filesByKey;
}

export function parseModelSettings(xml: string): Record<string, ObjectSettings> {
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
    // A part with nothing in it may close itself.
    const partRe = /<part\b([^>]*?)(?:\/>|>([\s\S]*?)<\/part>)/gi;
    let p;
    while ((p = partRe.exec(body))) {
      const attrs = parseAttrs(p[1]);
      const partMeta = readMetadata(p[2] ?? "");
      const extruder = Number.parseInt(partMeta.extruder ?? "", 10);
      parts.push({
        id: attrs.id,
        name: partMeta.name || "",
        // 0 is Bambu's "the object's".
        extruder: extruder > 0 ? extruder : objectExtruder,
        role: partRole(attrs.subtype, partMeta),
        settings: Object.fromEntries(Object.entries(partMeta).filter(([key]) => !PART_INFO_KEYS.has(key))),
      });
    }
    const { name: _name, extruder: _extruder, ...settings } = meta;
    objects[id] = { id, name: meta.name || "", extruder: objectExtruder, parts, settings };
  }
  return objects;
}

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

// Tolerates unclosed <metadata> tags, which MakerWorld exports emit for an empty Copyright.
export function extractModelMetadata(xml: string): ModelMetadata[] {
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
        text = decodeXml(tail.slice(0, closeAt));
        cursor += closeAt + "</metadata>".length;
      }
    }
    startRe.lastIndex = cursor;
    metas.push({ attrs: parseAttrs(rest.slice(0, endAttrs)), text });
  }
  return metas;
}

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

/** The package's small files read; the model files are left for readBambuModels. */
export async function readBambuPackage(input: Buffer | Uint8Array | JSZip): Promise<BambuPackage> {
  const zip = input instanceof JSZip ? input : await JSZip.loadAsync(input);
  const filesByKey = indexZipFiles(zip);
  const root = filesByKey["3d/3dmodel.model"];
  if (!root) throw new Error(NO_MODEL);

  let config: Settings | null = null;
  const projectRec = filesByKey["metadata/project_settings.config"];
  if (projectRec) {
    try {
      const parsed: unknown = JSON.parse(await projectRec.entry.async("string"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed as Settings;
    } catch {}
  }

  let modelSettingsXml: string | null = null;
  const modelSetRec = filesByKey["metadata/model_settings.config"];
  if (modelSetRec) modelSettingsXml = await modelSetRec.entry.async("string");

  return {
    zip,
    filesByKey,
    root,
    config,
    settings: extractBambuSettings(config),
    modelSettingsXml,
    modelSettings: modelSettingsXml ? parseModelSettings(modelSettingsXml) : {},
    plates: modelSettingsXml ? parsePlates(modelSettingsXml) : [],
  };
}

/** A model file's objects, build items and metadata. */
export function parseModelXml(xml: string): ParsedModel {
  return { objects: extractObjects(xml), buildItems: extractBuildItems(xml), metadata: extractModelMetadata(xml) };
}

/** Every model file of the package, parsed, keyed by its lowercased path. */
export async function readBambuModels(pkg: BambuPackage): Promise<Record<string, ParsedModel>> {
  const parsed: Record<string, ParsedModel> = {};
  for (const [key, rec] of Object.entries(pkg.filesByKey)) {
    if (!key.endsWith(".model")) continue;
    parsed[key] = parseModelXml(await rec.entry.async("string"));
  }
  return parsed;
}
