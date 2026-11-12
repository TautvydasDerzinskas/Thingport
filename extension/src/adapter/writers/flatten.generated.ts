// GENERATED from backend/src/adapter/writers/flatten.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A Bambu layout project as one core 3MF model, every mesh in 3D/3dmodel.model: what PrusaSlicer and Cura read.
// A multi-part object is either merged into one mesh whose triangle ranges name the parts ("merge", for
// PrusaSlicer's Slic3r_PE_model.config volumes) or kept as a group of meshes ("group", for Cura).
//
// Meshes are rewritten as they're written out, a chunk at a time, straight from the source's XML: a big project's
// vertices held as numbers, or its model as one string, run past what a worker has.

import { decodePaintState, encodePaintState, stateToMaterialIndex } from "../paint.generated";
import {
  NO_MODEL,
  type ModelMetadata,
  type ModelObject,
  type ObjectSettings,
  type ParsedModel,
  type PartRole,
  type PartSettings,
  type PlateInstance,
  type PlateSettings,
  type SourceBuildItem,
} from "../readers/bambuProject.generated";
import { asArray, type Settings } from "../settings.generated";
import {
  composeTransform,
  formatNumber,
  formatTransform,
  IDENTITY,
  mirrors,
  parseTransform,
  transformPoint,
} from "../transform.generated";
import { escapeXml, normalizePath, parseAttrs, pathKey } from "../xml.generated";

const CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const THUMB_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";

const KEEP_META_NAMES = new Set([
  "Title",
  "Description",
  "Designer",
  "Copyright",
  "License",
  "CreationDate",
  "ModificationDate",
]);

// What's handed on at a time while a mesh is written out.
const CHUNK_CHARS = 1 << 20;

export type FlattenMode = "merge" | "group";

/** What each triangle's painting is written as: Bambu's names and PrusaSlicer's, or none (Cura reads neither). */
export type PaintNames = "prusa" | "none";

/** One part of an object of the result, by its triangles in the object's mesh. */
export type Volume = {
  name: string;
  extruder: number;
  firstid: number;
  lastid: number;
  role: PartRole;
  /** The settings the designer changed for this part alone, by Bambu key. */
  settings: Record<string, string>;
};
export type ObjectMeta = {
  id: number;
  name: string;
  extruder: number;
  /** Every mesh's parts, one for a single mesh; empty for a group, whose parts are objects of their own. */
  volumes: Volume[];
  partIds: number[];
  /** The settings the designer changed for this object alone, by Bambu key. */
  settings: Record<string, string>;
};

export type OutBuildItem = {
  objectid: number;
  transform: string | null;
  printable: string;
  sourceObjectId: string;
  sourceInstanceId: number;
  outInstanceId?: number;
};

export type FlattenStats = {
  objects: number;
  buildItems: number;
  plates: number;
  vertices: number;
  triangles: number;
  paintColors: number;
  materials: number;
};

export type FlattenInput = {
  parsedModels: Record<string, ParsedModel>;
  rootPath: string;
  modelSettings: Record<string, ObjectSettings>;
  settings: Settings;
  plates: PlateSettings[];
  mode: FlattenMode;
  paint: PaintNames;
  /** The model's own metadata beside what's kept of the source's, by name. */
  modelMetadata?: Record<string, string>;
  /** Metadata put in an object of the result (`<metadatagroup>`): a whole mesh, one part of a group, or the group.
   *  `settings` are those the designer changed for the object it belongs to; `part` is the part's, for a mesh that's
   *  one part (a single mesh's or one of a group's). */
  objectMetadata?: (object: {
    kind: "mesh" | "part" | "group";
    extruder: number;
    settings: Record<string, string>;
    part: { role: PartRole; settings: Record<string, string> } | null;
  }) => Record<string, string>;
};

export type Flattened = {
  /** The model XML a chunk at a time: a large project's whole model is past V8's ~512 MB string limit. */
  modelXml: () => Generator<string>;
  objectMeta: ObjectMeta[];
  plates: PlateSettings[];
  buildItems: OutBuildItem[];
  /** Complete once the model XML has been consumed. */
  stats: FlattenStats;
};

function displayColor(hex: unknown): string {
  const raw = String(hex || "#808080").replace(/^#/, "");
  if (raw.length === 8) return `#${raw.toUpperCase()}`;
  if (raw.length === 6) return `#${raw.toUpperCase()}FF`;
  return "#808080FF";
}

function paintAttributes(paint: PaintNames, attrs: Record<string, string>, fallbackColor: string): string {
  if (paint === "none") return "";
  let out = "";
  const color = attrs.paint_color || attrs["slic3rpe:mmu_segmentation"] || fallbackColor;
  if (color) out += ` paint_color="${escapeXml(color)}" slic3rpe:mmu_segmentation="${escapeXml(color)}"`;
  const supports = attrs.paint_supports || attrs["slic3rpe:custom_supports"];
  if (supports) out += ` paint_supports="${escapeXml(supports)}" slic3rpe:custom_supports="${escapeXml(supports)}"`;
  const seam = attrs.paint_seam || attrs["slic3rpe:custom_seam"];
  if (seam) out += ` paint_seam="${escapeXml(seam)}" slic3rpe:custom_seam="${escapeXml(seam)}"`;
  const fuzzy = attrs.paint_fuzzy_skin || attrs["slic3rpe:fuzzy_skin"];
  if (fuzzy) out += ` paint_fuzzy_skin="${escapeXml(fuzzy)}" slic3rpe:fuzzy_skin="${escapeXml(fuzzy)}"`;
  return out;
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

const VERTEX_RE = /<vertex[\s/>][^>]*>/gi;
const TRIANGLE_RE = /<triangle[\s/>][^>]*>/gi;

function countMatches(body: string, re: RegExp): number {
  const scan = new RegExp(re.source, re.flags);
  let n = 0;
  while (scan.exec(body)) n++;
  return n;
}

/** Lines in chunks of about CHUNK_CHARS. */
class Chunker {
  private lines: string[] = [];
  private size = 0;
  push(line: string): string | null {
    this.lines.push(line);
    this.size += line.length + 1;
    return this.size >= CHUNK_CHARS ? this.take() : null;
  }
  take(): string | null {
    if (!this.lines.length) return null;
    const out = this.lines.join("\n") + "\n";
    this.lines = [];
    this.size = 0;
    return out;
  }
}

/** A mesh's vertices, moved by `transform` (into its object's frame when it's one part of several). */
function* vertexLines(body: string, transform: string): Generator<string> {
  const identity = transform === IDENTITY;
  const M = parseTransform(transform);
  const chunker = new Chunker();
  const re = new RegExp(VERTEX_RE.source, VERTEX_RE.flags);
  let m;
  while ((m = re.exec(body))) {
    const a = parseAttrs(m[0]);
    const x = Number.parseFloat(a.x) || 0;
    const y = Number.parseFloat(a.y) || 0;
    const z = Number.parseFloat(a.z) || 0;
    const p = identity ? [x, y, z] : transformPoint([x, y, z], M);
    const out = chunker.push(
      `     <vertex x="${formatNumber(p[0])}" y="${formatNumber(p[1])}" z="${formatNumber(p[2])}"/>`,
    );
    if (out) yield out;
  }
  const rest = chunker.take();
  if (rest) yield rest;
}

type TriangleStyle = {
  materialsId: number;
  extruder: number;
  paletteSize: number;
  paint: PaintNames;
  /** Painting for a triangle that has none: the part's own filament, so colours survive slicers that ignore
   *  per-part extruders. */
  fallbackColor: string;
  /** The mesh was mirrored as its vertices were moved: each triangle's first and last vertex swap so it faces out
   *  again, as PrusaSlicer writes a mirrored part. */
  flip: boolean;
  stats: FlattenStats;
};

/** A mesh's triangles, their vertex indices moved on by `offset`, each given its filament as a material. */
function* triangleLines(body: string, offset: number, style: TriangleStyle): Generator<string> {
  const defaultIdx = stateToMaterialIndex(0, style.extruder, style.paletteSize);
  const chunker = new Chunker();
  const re = new RegExp(TRIANGLE_RE.source, TRIANGLE_RE.flags);
  let m;
  while ((m = re.exec(body))) {
    const a = parseAttrs(m[0]);
    const color = a.paint_color || a["slic3rpe:mmu_segmentation"] || "";
    let idx = defaultIdx;
    const p1 = a.p1 != null && a.p1 !== "" ? Number.parseInt(a.p1, 10) : null;
    if (p1 !== null && Number.isInteger(p1)) idx = Math.min(Math.max(p1, 0), style.paletteSize - 1);
    else if (color) idx = stateToMaterialIndex(decodePaintState(color), style.extruder, style.paletteSize);
    const painting = paintAttributes(style.paint, a, style.fallbackColor);
    style.stats.triangles++;
    if (painting.includes("paint_color=")) style.stats.paintColors++;
    const first = Number.parseInt(a.v1, 10) + offset;
    const v2 = Number.parseInt(a.v2, 10) + offset;
    const last = Number.parseInt(a.v3, 10) + offset;
    const [v1, v3] = style.flip ? [last, first] : [first, last];
    const out = chunker.push(
      `     <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${style.materialsId}" p1="${idx}"${painting}/>`,
    );
    if (out) yield out;
  }
  const rest = chunker.take();
  if (rest) yield rest;
}

type Part = {
  name: string;
  extruder: number;
  body: string;
  /** Where the part sits in the object the build item places. */
  localTransform: string;
  role: PartRole;
  settings: Record<string, string>;
};
type CountedPart = Part & { vertices: number; triangles: number };

function counted(part: Part): CountedPart {
  return { ...part, vertices: countMatches(part.body, VERTEX_RE), triangles: countMatches(part.body, TRIANGLE_RE) };
}

/** The filament painted on a part's unpainted triangles: none on one that isn't printed itself (a modifier, a negative
 *  or support volume). */
function partColor(part: CountedPart): string {
  return part.role === "normal_part" ? encodePaintState(part.extruder) : "";
}

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
      formatTransform(composeTransform(transform, c.transform)),
      seen,
    );
  }
  return { kind: "assembly", obj, filePath, objectId, transform };
}

function partInfo(wrapper: Partial<ObjectSettings>, componentObjectId: string, componentIndex: number): PartSettings {
  const parts = wrapper.parts || [];
  return (
    parts.find((p) => String(p.id) === String(componentObjectId)) ||
    parts[componentIndex] || {
      name: wrapper.name || "",
      extruder: wrapper.extruder || 1,
      role: "normal_part",
      settings: {},
    }
  );
}

/** Settings in an order of their own, so two objects that changed the same ones compare equal. */
function settingsKey(settings: Record<string, string>): string {
  return JSON.stringify(Object.entries(settings).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

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

function formatCoreMetadata(name: string, text: string): string {
  const value = text.trim();
  if (!value) return ` <metadata name="${escapeXml(name)}" />`;
  return ` <metadata name="${escapeXml(name)}">${escapeXml(value)}</metadata>`;
}

function metadataGroup(values: Record<string, string>): string {
  const entries = Object.entries(values);
  if (!entries.length) return "";
  const lines = entries.map(
    ([name, value]) => `    <metadata name="${escapeXml(name)}">${escapeXml(value)}</metadata>`,
  );
  return `\n   <metadatagroup>\n${lines.join("\n")}\n   </metadatagroup>`;
}

/** An object of the result, written out when the model is: a mesh as it was, several parts merged into one mesh, one
 *  part of a group, or the group itself. */
type EmittedObject = { id: number; extruder: number; settings: Record<string, string> } & (
  | { kind: "mesh"; body: string; partSettings: Record<string, string> }
  | { kind: "merged"; parts: CountedPart[] }
  | { kind: "part"; part: CountedPart }
  | { kind: "group"; componentIds: number[] }
);

export function flattenProject({
  parsedModels,
  rootPath,
  modelSettings,
  settings,
  plates,
  mode,
  paint,
  modelMetadata,
  objectMetadata,
}: FlattenInput): Flattened {
  const root = parsedModels[pathKey(rootPath)];
  if (!root) throw new Error(NO_MODEL);

  const colors = asArray(settings.filament_colour);
  const types = asArray(settings.filament_type);
  const materialsId = 1;
  let nextId = 2;

  const meshObjects = new Map<string, { id: number; triangles: number } | null>();
  const meshTriangles = new Map<string, number>();
  const emitted: EmittedObject[] = [];
  const buildItems: OutBuildItem[] = [];
  const objectMeta: ObjectMeta[] = [];

  // One object of the result per mesh, filament and settings, its instances sharing it: a shared mesh used with
  // another filament or other settings is copied, since both live on the object.
  function ensureMesh(
    filePath: string,
    objectId: string,
    extruder: number,
    own: Record<string, string>,
    partSettings: Record<string, string>,
  ): { id: number; triangles: number } | null {
    const meshKey = `${pathKey(filePath)}::${objectId}`;
    const key = `${meshKey}|${extruder}|${settingsKey(own)}|${settingsKey(partSettings)}`;
    const existing = meshObjects.get(key);
    if (existing !== undefined) return existing;
    const src = getObject(parsedModels, filePath, objectId);
    let triangles = meshTriangles.get(meshKey);
    if (triangles === undefined && src?.hasMesh) {
      triangles = countMatches(src.body, TRIANGLE_RE);
      meshTriangles.set(meshKey, triangles);
    }
    // A mesh without triangles is nothing to print, and a slicer rejects the empty part it would be.
    if (!src || !triangles) {
      meshObjects.set(key, null);
      return null;
    }
    const made = { id: nextId++, triangles };
    meshObjects.set(key, made);
    emitted.push({ kind: "mesh", id: made.id, body: src.body, extruder, settings: own, partSettings });
    return made;
  }

  function rememberObjectMeta(meta: ObjectMeta) {
    if (!objectMeta.some((o) => o.id === meta.id)) objectMeta.push(meta);
  }

  // `node.transform` places it in the assembly the build item places; the wrappers resolveTarget passed through on
  // the way down are in it already. `ancestors` stops a file whose assemblies hold each other.
  function gatherParts(
    node: Resolved | null,
    info: Pick<PartSettings, "name" | "extruder" | "role" | "settings">,
    wrapper: Partial<ObjectSettings>,
    ancestors: Set<string>,
  ): Part[] {
    if (!node) return [];
    const local = node.transform ?? IDENTITY;
    if (node.kind === "mesh") return [{ ...info, body: node.obj.body, localTransform: local }];
    const mark = `${pathKey(node.filePath)}::${node.objectId}`;
    if (ancestors.has(mark)) return [];
    const inside = new Set(ancestors).add(mark);
    const out: Part[] = [];
    node.obj.components.forEach((c, index) => {
      // The object's own parts are named in model_settings.config; deeper ones take their parent part's.
      const part = wrapper.parts?.length ? partInfo(wrapper, c.objectid, index) : info;
      const childPath = c.path ? normalizePath(c.path) : node.filePath;
      const placed = formatTransform(composeTransform(local, c.transform));
      const child = resolveTarget(parsedModels, childPath, c.objectid, placed, new Set(inside));
      out.push(...gatherParts(child, part, { name: part.name, extruder: part.extruder, parts: [] }, inside));
    });
    return out;
  }

  const items: SourceBuildItem[] = root.buildItems.length
    ? root.buildItems
    : root.objects.map((o) => ({ objectid: o.id, transform: null, printable: "1", instanceId: 0 }));
  if (!items.length) throw new Error(NO_MODEL);

  for (const item of items) {
    const wrapper: Partial<ObjectSettings> = modelSettings[String(item.objectid)] || {};
    const own = wrapper.settings ?? {};
    const resolved = resolveTarget(parsedModels, rootPath, item.objectid, item.transform, new Set());
    if (!resolved) continue;
    const printable = item.printable ?? "1";
    const source = { sourceObjectId: String(item.objectid), sourceInstanceId: item.instanceId };
    if (resolved.kind === "mesh") {
      // A single mesh is the object's one part, printed whatever its entry says, in the part's filament if it has one.
      const part = partInfo(wrapper, resolved.objectId, 0);
      const extruder = part.extruder || wrapper.extruder || 1;
      const mesh = ensureMesh(resolved.filePath, resolved.objectId, extruder, own, part.settings);
      if (!mesh) continue;
      buildItems.push({ objectid: mesh.id, transform: resolved.transform, printable, ...source });
      const volume: Volume = {
        name: part.name,
        extruder,
        firstid: 0,
        lastid: mesh.triangles - 1,
        role: "normal_part",
        settings: part.settings,
      };
      rememberObjectMeta({
        id: mesh.id,
        name: wrapper.name || "",
        extruder,
        volumes: [volume],
        partIds: [],
        settings: own,
      });
      continue;
    }
    const top = {
      name: wrapper.name || "",
      extruder: wrapper.extruder || 1,
      role: "normal_part" as const,
      settings: {},
    };
    // The build item places the assembly with the wrappers above it; its parts are placed inside it.
    const parts = gatherParts({ ...resolved, transform: IDENTITY }, top, wrapper, new Set())
      .map(counted)
      .filter((part) => part.triangles > 0);
    if (!parts.length) continue;
    const extruder = wrapper.extruder || parts[0].extruder;
    const name = wrapper.name || parts[0].name || "";
    if (mode === "merge") {
      const id = nextId++;
      emitted.push({ kind: "merged", id, parts, extruder, settings: own });
      buildItems.push({ objectid: id, transform: resolved.transform, printable, ...source });
      let first = 0;
      const volumes = parts.map((part): Volume => {
        const volume = {
          name: part.name,
          extruder: part.extruder,
          firstid: first,
          lastid: first + part.triangles - 1,
          role: part.role,
          settings: part.settings,
        };
        first += part.triangles;
        return volume;
      });
      rememberObjectMeta({ id, name, extruder, volumes, partIds: [], settings: own });
      continue;
    }
    const partIds = parts.map((part) => {
      const id = nextId++;
      emitted.push({ kind: "part", id, part, extruder: part.extruder, settings: own });
      return id;
    });
    const groupId = nextId++;
    emitted.push({ kind: "group", id: groupId, componentIds: partIds, extruder, settings: own });
    buildItems.push({ objectid: groupId, transform: resolved.transform, printable, ...source });
    rememberObjectMeta({ id: groupId, name, extruder, volumes: [], partIds, settings: own });
  }

  if (!emitted.length) throw new Error(NO_MODEL);

  const metadataXml: string[] = [];
  for (const meta of root.metadata as ModelMetadata[]) {
    const name = meta.attrs.name;
    if (name && KEEP_META_NAMES.has(name)) metadataXml.push(formatCoreMetadata(name, meta.text));
  }
  metadataXml.push(` <metadata name="Application">Thingport</metadata>`);
  for (const [name, value] of Object.entries(modelMetadata ?? {})) metadataXml.push(formatCoreMetadata(name, value));

  const paletteSize = colors.length || 1;
  const pindexFor = (extruder: number) =>
    colors.length ? Math.min(Math.max(0, (extruder || 1) - 1), colors.length - 1) : 0;

  const stats: FlattenStats = {
    objects: emitted.length,
    buildItems: buildItems.length,
    plates: 0,
    vertices: 0,
    triangles: 0,
    paintColors: 0,
    materials: colors.length || 1,
  };

  const style = (extruder: number, fallbackColor: string, flip = false): TriangleStyle => ({
    materialsId,
    extruder,
    paletteSize,
    paint,
    fallbackColor,
    flip,
    stats,
  });

  const buildXml = buildItems
    .map((item) => {
      const t = item.transform ? ` transform="${item.transform}"` : "";
      return `  <item objectid="${item.objectid}"${t} printable="${item.printable}"/>`;
    })
    .join("\n");

  function* meshObject(
    id: number,
    extruder: number,
    meta: string,
    parts: { body: string; transform: string; offset: number; triangles: TriangleStyle }[],
  ): Generator<string> {
    yield `\n <object id="${id}" type="model" pid="${materialsId}" pindex="${pindexFor(extruder)}">${meta}\n   <mesh>\n    <vertices>\n`;
    for (const part of parts) yield* vertexLines(part.body, part.transform);
    yield "    </vertices>\n    <triangles>\n";
    for (const part of parts) yield* triangleLines(part.body, part.offset, part.triangles);
    yield "    </triangles>\n   </mesh>\n  </object>";
  }

  function* modelXml(): Generator<string> {
    yield [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">`,
      metadataXml.join("\n"),
      " <resources>",
      ` ${buildBasematerialsXml(materialsId, colors, types)}`,
    ].join("\n");
    for (const obj of emitted) {
      if (obj.kind === "group") {
        const comps = obj.componentIds.map((id) => `    <component objectid="${id}"/>`).join("\n");
        const meta = metadataGroup(
          objectMetadata?.({ kind: "group", extruder: obj.extruder, settings: obj.settings, part: null }) ?? {},
        );
        yield `\n <object id="${obj.id}" type="model">${meta}\n   <components>\n${comps}\n   </components>\n  </object>`;
        continue;
      }
      if (obj.kind === "merged") {
        const meta = metadataGroup(
          objectMetadata?.({ kind: "mesh", extruder: obj.extruder, settings: obj.settings, part: null }) ?? {},
        );
        let offset = 0;
        const parts = obj.parts.map((part) => {
          const entry = {
            body: part.body,
            transform: part.localTransform,
            offset,
            triangles: style(part.extruder, partColor(part), mirrors(part.localTransform)),
          };
          offset += part.vertices;
          return entry;
        });
        stats.vertices += offset;
        yield* meshObject(obj.id, obj.extruder, meta, parts);
        continue;
      }
      if (obj.kind === "part") {
        const { part } = obj;
        const meta = metadataGroup(
          objectMetadata?.({
            kind: "part",
            extruder: part.extruder,
            settings: obj.settings,
            part: { role: part.role, settings: part.settings },
          }) ?? {},
        );
        stats.vertices += part.vertices;
        yield* meshObject(obj.id, part.extruder, meta, [
          {
            body: part.body,
            transform: part.localTransform,
            offset: 0,
            triangles: style(part.extruder, partColor(part), mirrors(part.localTransform)),
          },
        ]);
        continue;
      }
      const meta = metadataGroup(
        objectMetadata?.({
          kind: "mesh",
          extruder: obj.extruder,
          settings: obj.settings,
          part: { role: "normal_part", settings: obj.partSettings },
        }) ?? {},
      );
      stats.vertices += countMatches(obj.body, VERTEX_RE);
      yield* meshObject(obj.id, obj.extruder, meta, [
        { body: obj.body, transform: IDENTITY, offset: 0, triangles: style(obj.extruder, "") },
      ]);
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

  return { modelXml, objectMeta, plates: assignedPlates, buildItems, stats };
}

export function contentTypesXml(): string {
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

export function relsXml(hasThumbnail: boolean): string {
  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_REL}"/>`,
  ];
  if (hasThumbnail) rels.push(` <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="${THUMB_REL}"/>`);
  rels.push("</Relationships>", "");
  return rels.join("\n");
}
