import fs from "node:fs/promises";
import * as cheerio from "cheerio";
import { bedBoxOf, bedCentre, plateColumns, plateOrigin, type BedBox } from "../adapter/printer";
import { mirrors } from "../adapter/transform";
import { decodeXml } from "../adapter/xml";
import { findStartPart, partNames } from "../adapter/format";
import { listZipEntries, readZipEntry, walkZipEntries } from "../utils/zipReader";
import { decodePaintState, readColor, readColorGroups, sharePalette, type ThreeMfColors } from "./threeMfColors";

// Builds the cached GLB the 3D preview loads instead of parsing a raw .3mf in the browser. It
// follows the same rules as frontend/src/utils/bambuThreeMf.ts but scans the XML with regexes
// into typed arrays instead of a DOM, which hangs on models with millions of triangles.
//
// Runs in a worker thread (modelPreviewWorker.ts); keep it free of config/db imports.

// Node has no FileReader, but GLTFExporter needs one for its GLB export path.
class NodeFileReader {
  onload?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  result: ArrayBuffer | string | null = null;
  error: unknown = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        this.result = buf;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      })
      .catch((err) => {
        this.error = err;
        this.onerror?.({ target: this });
        this.onloadend?.({ target: this });
      });
  }

  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      })
      .catch((err) => {
        this.error = err;
        this.onerror?.({ target: this });
        this.onloadend?.({ target: this });
      });
  }
}
if (typeof (globalThis as { FileReader?: unknown }).FileReader === "undefined") {
  (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
}

const ATTRIBUTE_RE = /(?:^|\s)([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function getAttr(attrs: string, name: string): string | null {
  for (const attribute of attrs.matchAll(ATTRIBUTE_RE)) {
    if (attribute[1] === name) return attribute[2] ?? attribute[3];
  }
  return null;
}

/** Different Bambu Studio versions spell it plate_id or plater_id. */
function findPlateIdAttr(attrs: string): number | null {
  for (const attribute of attrs.matchAll(ATTRIBUTE_RE)) {
    if (!/^(?:[\w-]+:)?(?:plate_id|plater_id|plateid|platerid)$/i.test(attribute[1])) continue;
    const parsed = Number.parseInt(attribute[2] ?? attribute[3], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 3MF's 3x4 affine transform: [m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz], which a point multiplies as a row
 *  vector (3MF core spec): x' = x*m00 + y*m10 + z*m20 + tx. */
function parseTransform3MF(str: string | null): number[] | null {
  if (!str) return null;
  const v = str.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : null;
}

export function applyAffineToVertices(vertices: Float32Array, t: number[]): Float32Array {
  const out = new Float32Array(vertices.length);
  const [t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11] = t;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    out[i] = x * t0 + y * t3 + z * t6 + t9;
    out[i + 1] = x * t1 + y * t4 + z * t7 + t10;
    out[i + 2] = x * t2 + y * t5 + z * t8 + t11;
  }
  return out;
}

type FastMesh = {
  vertices: Float32Array;
  triangles: Uint32Array;
  extruder: number;
  /** The file said what colour this is -- its faces did, or the object they belong to -- so nothing placing
   *  the mesh may say otherwise. */
  ownColor?: boolean;
  /** The part of its object this mesh is, or a piece of when its faces were split by colour. */
  part?: { key: string; name: string | null };
};

function placeMesh(mesh: FastMesh, transform: number[] | null): FastMesh {
  if (!transform) return mesh;
  const triangles = mirrors(transform) ? mesh.triangles.slice() : mesh.triangles;
  if (triangles !== mesh.triangles) {
    for (let i = 0; i < triangles.length; i += 3) {
      triangles[i + 1] = mesh.triangles[i + 2];
      triangles[i + 2] = mesh.triangles[i + 1];
    }
  }
  return { ...mesh, triangles, vertices: applyAffineToVertices(mesh.vertices, transform) };
}

const MESH_RE = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/g;
const VERTEX_RE = /<vertex\b([^>]*)>/g;
const TRIANGLE_RE = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
// The same, keeping whatever else the triangle carries, for a file that colours its faces one by one. Apart so
// the common case doesn't allocate a string per triangle on a model of millions of them.
const COLORED_TRIANGLE_RE = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"([^>]*)>/g;

/** Which colour slot a triangle belongs to, from its attributes; null where it says nothing. */
type TriangleSlot = (attributes: string) => number | null;

/**
 * Extracts every <mesh>'s vertices/triangles via regex, without building a DOM.
 *
 * With `slotOf`, a mesh whose faces aren't all one colour comes back split -- one mesh per colour, as a painted
 * Bambu project's parts already arrive -- since that is what the builder downstream colours.
 */
function extractMeshesFast(xml: string, extruder: number, slotOf?: TriangleSlot): FastMesh[] {
  const meshes: FastMesh[] = [];
  MESH_RE.lastIndex = 0;
  let meshMatch: RegExpExecArray | null;
  while ((meshMatch = MESH_RE.exec(xml))) {
    const inner = meshMatch[1];
    const vertices: number[] = [];
    VERTEX_RE.lastIndex = 0;
    let vm: RegExpExecArray | null;
    while ((vm = VERTEX_RE.exec(inner))) {
      // Preserve vertex indices even for a malformed point so its faces cannot silently refer to a different point.
      let x = NaN;
      let y = NaN;
      let z = NaN;
      ATTRIBUTE_RE.lastIndex = 0;
      let attribute: RegExpExecArray | null;
      while ((attribute = ATTRIBUTE_RE.exec(vm[1]))) {
        const name = attribute[1];
        if (name !== "x" && name !== "y" && name !== "z") continue;
        const raw = (attribute[2] ?? attribute[3]).trim();
        const value = raw ? Number(raw) : NaN;
        if (name === "x") x = value;
        else if (name === "y") y = value;
        else z = value;
      }
      vertices.push(x, y, z);
    }
    const triangles: number[] = [];
    // One entry per triangle, filled in only once a face names a colour of its own; -1 is a face that didn't,
    // which keeps whatever colour the object -- or whatever places it -- gives the rest of the mesh.
    let slots: number[] | null = null;
    const triangleRe = slotOf ? COLORED_TRIANGLE_RE : TRIANGLE_RE;
    triangleRe.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = triangleRe.exec(inner))) {
      triangles.push(parseInt(tm[1], 10), parseInt(tm[2], 10), parseInt(tm[3], 10));
      if (!slotOf) continue;
      const slot = slotOf(tm[4]);
      if (slot === null) continue;
      slots ??= Array.from<number>({ length: triangles.length / 3 }).fill(-1);
      slots[triangles.length / 3 - 1] = slot;
    }
    if (vertices.length === 0 || triangles.length === 0) continue;
    if (slots) {
      // Faces after the last coloured one were never reached by the fill above.
      while (slots.length < triangles.length / 3) slots.push(-1);
      for (const part of splitBySlot(vertices, triangles, slots, extruder)) meshes.push(part);
    } else {
      meshes.push({ vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles), extruder });
    }
  }
  return meshes;
}

/** One mesh per colour slot, each keeping only the vertices its own faces use; slot -1 is the faces that named
 *  no colour, which stay `extruder` and stay open to being given another. */
function splitBySlot(vertices: number[], triangles: number[], slots: number[], extruder: number): FastMesh[] {
  const parts = new Map<number, { vertices: number[]; triangles: number[]; moved: Map<number, number> }>();
  for (let face = 0; face < slots.length; face++) {
    const slot = slots[face];
    let part = parts.get(slot);
    if (!part) {
      part = { vertices: [], triangles: [], moved: new Map() };
      parts.set(slot, part);
    }
    for (let corner = 0; corner < 3; corner++) {
      const original = triangles[face * 3 + corner];
      let moved = part.moved.get(original);
      if (moved === undefined) {
        moved = part.vertices.length / 3;
        part.moved.set(original, moved);
        part.vertices.push(vertices[original * 3], vertices[original * 3 + 1], vertices[original * 3 + 2]);
      }
      part.triangles.push(moved);
    }
  }
  return [...parts].map(([slot, part]) => ({
    vertices: Float32Array.from(part.vertices),
    triangles: Uint32Array.from(part.triangles),
    extruder: slot < 0 ? extruder : slot,
    ownColor: slot >= 0,
  }));
}

type ObjectData = { id: string; name: string | null; meshes: FastMesh[] };
type BuildItem = { objectId: string; transform: number[] | null; plateId: number | null };
export type PlateSummary = { index: number; name: string | null; objectCount: number };
export type ThreeMfBuildPlate = Omit<PlateSummary, "index"> & { index: number | null; thumbnail: boolean };

/** A part of an object as model_settings.config lists it: its mesh's id, 0-based filament, name, and whether it prints
 *  (not a modifier or a support or negative volume). */
type PartSettings = { id: string; extruder: number | null; name: string | null; printed: boolean };

type StructuralData = {
  extruderMapById: Map<string, number>;
  /** Each object's parts, in the order the slicer makes them. */
  partsByObject: Map<string, PartSettings[]>;
  objectNameById: Map<string, string>;
  plateAssignmentsByObjectId: Map<string, number>;
  plateAssignmentsByInstance: Map<string, number>;
  plateIds: Set<number>;
  plateNames: Map<number, string>;
  plateOffsets: Map<number, { offsetX: number; offsetY: number }>;
  bedCenterOffset: [number, number];
};

function parseModelSettingsConfig(xml: string): StructuralData {
  const data: StructuralData = {
    extruderMapById: new Map(),
    partsByObject: new Map(),
    objectNameById: new Map(),
    plateAssignmentsByObjectId: new Map(),
    plateAssignmentsByInstance: new Map(),
    plateIds: new Set(),
    plateNames: new Map(),
    plateOffsets: new Map(),
    bedCenterOffset: [0, 0],
  };
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(xml, { xml: true });
  } catch {
    return data;
  }

  const centerOffset = $("config").first().attr("thingport_bed_center_offset")?.trim().split(/\s+/).map(Number);
  if (centerOffset?.length === 2 && centerOffset.every(Number.isFinite))
    data.bedCenterOffset = [centerOffset[0], centerOffset[1]];

  $("object").each((_i, objEl) => {
    const $obj = $(objEl);
    const objectId = $obj.attr("id");
    if (!objectId) return;

    const extruderMeta = $obj.children('metadata[key="extruder"]').first();
    const extruderVal = extruderMeta.attr("value");
    if (extruderVal) data.extruderMapById.set(objectId, Math.max(0, parseInt(extruderVal, 10) - 1));

    const nameVal = $obj.children('metadata[key="name"]').first().attr("value");
    if (nameVal) data.objectNameById.set(objectId, nameVal);

    const parts: PartSettings[] = [];
    $obj.find("part").each((_j, partEl) => {
      const $part = $(partEl);
      const partId = $part.attr("id");
      if (!partId) return;
      const role = $part.attr("subtype");
      const partExtruderVal = $part.children('metadata[key="extruder"]').first().attr("value");
      parts.push({
        id: partId,
        extruder: partExtruderVal ? Math.max(0, parseInt(partExtruderVal, 10) - 1) : null,
        name: $part.children('metadata[key="name"]').first().attr("value") || null,
        printed: !role || role === "normal_part",
      });
    });
    data.partsByObject.set(objectId, parts);
  });

  $("plate").each((_i, plateEl) => {
    const $plate = $(plateEl);
    let plateId: number | null = null;
    let offsetX: number | undefined;
    let offsetY: number | undefined;
    let plateName: string | undefined;
    $plate.find("> metadata").each((_j, metaEl) => {
      const $meta = $(metaEl);
      const key = $meta.attr("key");
      const value = $meta.attr("value");
      if ((key === "plater_id" || key === "plate_id") && value) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) plateId = parsed;
      } else if (key === "pos_x" && value) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) offsetX = parsed;
      } else if (key === "pos_y" && value) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) offsetY = parsed;
      } else if (key === "plater_name" && value?.trim()) {
        plateName = value.trim();
      }
    });
    if (plateId == null) return;
    data.plateIds.add(plateId);
    if (offsetX !== undefined || offsetY !== undefined)
      data.plateOffsets.set(plateId, { offsetX: offsetX ?? 0, offsetY: offsetY ?? 0 });
    if (plateName) data.plateNames.set(plateId, plateName);

    $plate.find("model_instance").each((_j, instEl) => {
      const instance = $(instEl);
      const objectIdVal = instance.children('metadata[key="object_id"]').first().attr("value");
      if (!objectIdVal) return;
      const instanceId = instance.children('metadata[key="instance_id"]').first().attr("value");
      if (instanceId === undefined) data.plateAssignmentsByObjectId.set(objectIdVal, plateId as number);
      else data.plateAssignmentsByInstance.set(`${objectIdVal}:${instanceId}`, plateId as number);
    });
  });

  return data;
}

function parseProjectSettingsJson(text: string): {
  filamentColors: string[];
  buildVolume: { x: number; y: number } | null;
  bed: BedBox | null;
} {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const filamentColors = Array.isArray(json.filament_colour)
      ? json.filament_colour.map((c) => (typeof c === "string" ? (readColor(c) ?? "") : ""))
      : [];
    let buildVolume: { x: number; y: number } | null = null;
    const area = json.printable_area;
    if (Array.isArray(area) && area.length >= 3 && typeof area[2] === "string") {
      const match = area[2].match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
      if (match) buildVolume = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
    }
    return { filamentColors, buildVolume, bed: bedBoxOf(area) };
  } catch {
    return { filamentColors: [], buildVolume: null, bed: null };
  }
}

const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*)\/?>/g;
const ITEM_RE = /<item\b([^>]*)\/?>/g;

type InternalComponentRef = {
  refId: string;
  transform: number[] | null;
  extruder: number;
  part: FastMesh["part"];
};

const MAX_COMPONENT_DEPTH = 8;

type MainComponent = { attrs: string; objectId: string | null; path: string | null; part: PartSettings | null };
type MainObject = { attrs: string; inner: string; components: MainComponent[] };
type MainPlacement = BuildItem & { attrs: string; instance: number };

function readObjectName(structural: StructuralData, objectId: string, attrs = ""): string | null {
  return structural.objectNameById.get(objectId) ?? (decodeXml(getAttr(attrs, "name") ?? "") || null);
}

/** A component's part, as Bambu Studio matches them: the one at its place, else the first with its mesh's id. Part
 *  files number their meshes apart, so two components can name the same id. */
function partAt(parts: PartSettings[] | undefined, index: number, objectId: string | null): PartSettings | null {
  if (!parts || !objectId) return null;
  return parts[index]?.id === objectId ? parts[index] : (parts.find((part) => part.id === objectId) ?? null);
}

/** The main model's objects; `printedOnly` leaves out the components that don't print, as Studio brings in none. */
function readMainObjects(xml: string, structural: StructuralData, printedOnly = false): Map<string, MainObject> {
  const objects = new Map<string, MainObject>();
  for (const [, attrs, inner] of xml.matchAll(OBJECT_RE)) {
    const id = getAttr(attrs, "id");
    if (!id) continue;
    const components: MainComponent[] = [];
    for (const [index, [, component]] of [...inner.matchAll(COMPONENT_RE)].entries()) {
      const objectId = getAttr(component, "objectid");
      const part = partAt(structural.partsByObject.get(id), index, objectId);
      if (printedOnly && part && !part.printed) continue;
      components.push({
        attrs: component,
        objectId,
        path: getAttr(component, "p:path") ?? getAttr(component, "path"),
        part,
      });
    }
    objects.set(id, { attrs, inner, components });
  }
  return objects;
}

function readMainPlacements(xml: string, forStudio: boolean): MainPlacement[] {
  const build = xml.match(/<build\b[\s\S]*?<\/build>/)?.[0] ?? "";
  const counts = new Map<string, number>();
  const placements: MainPlacement[] = [];
  for (const [, attrs] of build.matchAll(ITEM_RE)) {
    const objectId = getAttr(attrs, "objectid");
    if (!objectId) continue;
    const instance = counts.get(objectId) ?? 0;
    counts.set(objectId, instance + 1);
    const printable = getAttr(attrs, "printable");
    if (forStudio && (printable === "0" || printable === "false")) continue;
    placements.push({
      attrs,
      objectId,
      instance,
      transform: parseTransform3MF(getAttr(attrs, "transform")),
      plateId: null,
    });
  }
  return placements;
}

/** Studio only needs the objects reachable from printable placements. */
function studioMainObjects(objects: Map<string, MainObject>, placements: MainPlacement[]) {
  const depths = new Map<string, number>();
  const visit = (id: string, depth: number) => {
    const object = objects.get(id);
    if (!object || depth >= (depths.get(id) ?? Infinity)) return;
    depths.set(id, depth);
    if (depth < MAX_COMPONENT_DEPTH)
      for (const ref of object.components) if (!ref.path && ref.objectId) visit(ref.objectId, depth + 1);
  };
  for (const item of placements) visit(item.objectId, 0);
  return new Map([...objects].filter(([id]) => depths.has(id)));
}

/** Counts <triangle .../> tags without allocating a match array. */
function countTriangleTags(xml: string): number {
  let count = 0;
  let i = xml.indexOf("<triangle");
  while (i !== -1) {
    const next = xml.charCodeAt(i + 9);
    if (next === 32 || next === 9 || next === 10 || next === 13 || next === 47 || next === 62) count++;
    i = xml.indexOf("<triangle", i + 9);
  }
  return count;
}

/** The object a component's objectid names, or every object when it names none (or a missing one). */
function partFileTargetIds(objects: Map<string, string>, objectId: string | null): string[] {
  return objectId && objects.has(objectId) ? [objectId] : [...objects.keys()];
}

/** Bambu Studio keeps every part of a multi-part object in one file and references each part by
 * objectid, so a component takes only the object it names. */
/** One part file's objects, by id: what is inside each, what it declares, and the file's own colour groups. */
type PartFile = {
  objects: Map<string, string>;
  attributes: Map<string, string>;
  colors: ThreeMfColors | null;
};

function createPartFileResolver(loadExternalModel: (path: string) => Promise<string | null>, palette: string[]) {
  const objectsByPath = new Map<string, PartFile | null>();
  const meshCache = new Map<string, FastMesh[]>();
  const countCache = new Map<string, number>();

  const objectsIn = async (path: string): Promise<PartFile | null> => {
    if (objectsByPath.has(path)) return objectsByPath.get(path)!;
    const xml = await loadExternalModel(path);
    let file: PartFile | null = null;
    if (xml) {
      file = { objects: new Map(), attributes: new Map(), colors: sharePalette(palette, readColorGroups(xml)) };
      const objectRe = new RegExp(OBJECT_RE.source, "g");
      let om: RegExpExecArray | null;
      while ((om = objectRe.exec(xml))) {
        const id = getAttr(om[1], "id");
        if (!id) continue;
        file.objects.set(id, om[2]);
        file.attributes.set(id, om[1]);
      }
    }
    objectsByPath.set(path, file);
    return file;
  };

  const innerRefs = (inner: string, objects: Map<string, string>) => {
    const refs: { refId: string; transform: number[] | null }[] = [];
    const componentRe = new RegExp(COMPONENT_RE.source, "g");
    let cm: RegExpExecArray | null;
    while ((cm = componentRe.exec(inner))) {
      const refId = getAttr(cm[1], "objectid");
      const hasPath = (getAttr(cm[1], "p:path") ?? getAttr(cm[1], "path")) !== null;
      if (refId && !hasPath && objects.has(refId))
        refs.push({ refId, transform: parseTransform3MF(getAttr(cm[1], "transform")) });
    }
    return refs;
  };

  /** Parsed once however many times it's placed. */
  const objectMeshes = async (path: string, file: PartFile, id: string, depth: number): Promise<FastMesh[]> => {
    const key = `${path}#${id}`;
    const cached = meshCache.get(key);
    if (cached) return cached;
    const inner = file.objects.get(id) ?? "";
    const attrs = file.attributes.get(id) ?? "";
    // The part file's own colour groups, in their own stretch of the shared palette: resource ids are each
    // model file's own, so reading these triangles against the main model's would colour them by whatever
    // happened to share an id.
    const slot = objectTriangleSlot(attrs, inner, file.colors);
    const objectSlot = file.colors?.slotOf(getAttr(attrs, "pid"), Number.parseInt(getAttr(attrs, "pindex") ?? "", 10));
    const meshes = extractMeshesFast(inner, objectSlot ?? 0, slot ?? undefined);
    if (objectSlot != null) for (const mesh of meshes) mesh.ownColor = true;
    if (depth < MAX_COMPONENT_DEPTH) {
      for (const ref of innerRefs(inner, file.objects)) {
        for (const mesh of await objectMeshes(path, file, ref.refId, depth + 1)) {
          meshes.push(placeMesh(mesh, ref.transform));
        }
      }
    }
    meshCache.set(key, meshes);
    return meshes;
  };

  const objectTriangles = (path: string, file: PartFile, id: string, depth: number): number => {
    const key = `${path}#${id}`;
    const cached = countCache.get(key);
    if (cached !== undefined) return cached;
    const inner = file.objects.get(id) ?? "";
    let count = countTriangleTags(inner);
    if (depth < MAX_COMPONENT_DEPTH) {
      for (const ref of innerRefs(inner, file.objects)) count += objectTriangles(path, file, ref.refId, depth + 1);
    }
    countCache.set(key, count);
    return count;
  };

  return {
    async meshes(path: string, objectId: string | null): Promise<FastMesh[]> {
      const file = await objectsIn(path);
      if (!file) return [];
      const out: FastMesh[] = [];
      for (const id of partFileTargetIds(file.objects, objectId)) out.push(...(await objectMeshes(path, file, id, 0)));
      return out;
    },
    async triangles(path: string, objectId: string | null): Promise<number> {
      const file = await objectsIn(path);
      if (!file) return 0;
      return partFileTargetIds(file.objects, objectId).reduce((sum, id) => sum + objectTriangles(path, file, id, 0), 0);
    },
  };
}

type PartFileResolver = ReturnType<typeof createPartFileResolver>;

/** Triangles the preview would materialize after expanding components and placements, counted
 * from tags so an over-budget file never allocates its geometry. */
async function countRenderedTriangles(
  objects: Map<string, MainObject>,
  placements: MainPlacement[],
  partFiles: PartFileResolver,
): Promise<number> {
  const ownCount = new Map<string, number>();
  const internalRefs = new Map<string, string[]>();

  for (const [objectId, { inner, components }] of objects) {
    let count = countTriangleTags(inner);
    const refs: string[] = [];
    for (const { path: extPath, objectId: compObjectId } of components) {
      if (extPath) {
        count += await partFiles.triangles(extPath, compObjectId);
      } else if (compObjectId) {
        refs.push(compObjectId);
      }
    }
    ownCount.set(objectId, count);
    if (refs.length > 0) internalRefs.set(objectId, refs);
  }

  // Memoized so a pathological fan-out can't make the count itself explode.
  const memo = new Map<string, number>();
  const totalFor = (objectId: string, depth: number): number => {
    const key = `${objectId}:${depth}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let total = ownCount.get(objectId) ?? 0;
    if (depth < MAX_COMPONENT_DEPTH) {
      for (const ref of internalRefs.get(objectId) ?? []) total += totalFor(ref, depth + 1);
    }
    memo.set(key, total);
    return total;
  };

  return placements.reduce((sum, { objectId }) => sum + totalFor(objectId, 0), 0);
}

const PAINT_ATTR_RE = /(?:^|\s)paint_color="([^"]*)"/;
const P1_ATTR_RE = /(?:^|\s)p1="(\d+)"/;
const PID_ATTR_RE = /(?:^|\s)pid="([^"]*)"/;

/**
 * How an object's triangles say which colour they are, or null where none of them can.
 *
 * Two ways, and a file may carry both: `paint_color`, which a slicer writes when someone paints a model, and
 * `p1` into the colour group the object or the triangle points at, which is the 3MF spec's own way and what
 * Thingport's customizer writes. The painting wins where there is both, as it is the later word -- and the
 * two agree anyway in a file we wrote.
 */
function objectTriangleSlot(objectAttrs: string, inner: string, colors: ThreeMfColors | null): TriangleSlot | null {
  const objectPid = getAttr(objectAttrs, "pid");
  const byIndex = colors && (objectPid !== null || inner.includes(" p1=")) ? colors : null;
  const painted = inner.includes("paint_color=");
  if (!byIndex && !painted) return null;
  // A model asks for the same handful of paint strings over and over; decoding is a bitstream walk each time.
  const decoded = new Map<string, number>();
  return (attributes) => {
    if (painted) {
      const paint = attributes.match(PAINT_ATTR_RE)?.[1];
      if (paint) {
        let state = decoded.get(paint);
        if (state === undefined) {
          state = decodePaintState(paint);
          decoded.set(paint, state);
        }
        if (state > 0) return state - 1;
      }
    }
    if (!byIndex) return null;
    const p1 = attributes.match(P1_ATTR_RE)?.[1];
    if (p1 === undefined) return null;
    return byIndex.slotOf(attributes.match(PID_ATTR_RE)?.[1] ?? objectPid, Number.parseInt(p1, 10));
  };
}

async function parseMainModel(
  mainObjects: Map<string, MainObject>,
  placements: MainPlacement[],
  structural: StructuralData,
  partFiles: PartFileResolver,
  colors: ThreeMfColors | null,
  forStudio: boolean,
): Promise<Map<string, ObjectData>> {
  const objects = new Map<string, ObjectData>();
  // A <component> without p:path references another <object> in this document. Order isn't
  // guaranteed, so these are resolved in a second pass.
  const internalRefsByObjectId = new Map<string, InternalComponentRef[]>();

  for (const [objectId, { attrs, inner, components }] of mainObjects) {
    let defaultExtruder = structural.extruderMapById.get(objectId) ?? -1;
    if (defaultExtruder < 0) {
      const extruderAttr = getAttr(attrs, "p:extruder") ?? getAttr(attrs, "extruder") ?? "1";
      defaultExtruder = Math.max(0, parseInt(extruderAttr, 10) - 1);
    }
    // An object pointing at a colour group is that colour, bar the triangles naming another.
    const objectSlot = colors?.slotOf(getAttr(attrs, "pid"), Number.parseInt(getAttr(attrs, "pindex") ?? "", 10));
    if (objectSlot != null) defaultExtruder = objectSlot;

    const meshes = extractMeshesFast(inner, defaultExtruder, objectTriangleSlot(attrs, inner, colors) ?? undefined);
    if (objectSlot != null) for (const mesh of meshes) mesh.ownColor = true;

    for (const [
      index,
      { attrs: cAttrs, path: extPath, objectId: compObjectId, part: settings },
    ] of components.entries()) {
      const transform = parseTransform3MF(getAttr(cAttrs, "transform"));
      const compExtruder = settings?.extruder ?? defaultExtruder;
      // Each component is a part of its own, even of the same mesh as another.
      const part = { key: `${objectId}#${index}`, name: settings?.name ?? null };

      if (extPath) {
        for (const mesh of await partFiles.meshes(extPath, compObjectId)) {
          meshes.push({
            ...placeMesh(mesh, transform),
            // A mesh whose own faces named their colours keeps them; the part's filament is for the rest.
            extruder: mesh.ownColor ? mesh.extruder : compExtruder,
            part,
          });
        }
      } else if (compObjectId) {
        if (!internalRefsByObjectId.has(objectId)) internalRefsByObjectId.set(objectId, []);
        internalRefsByObjectId.get(objectId)!.push({ refId: compObjectId, transform, extruder: compExtruder, part });
      }
    }

    // Keep pure wrapper objects too: they need an entry for the resolution pass.
    if (meshes.length > 0 || internalRefsByObjectId.has(objectId)) {
      objects.set(objectId, { id: objectId, name: readObjectName(structural, objectId, attrs), meshes });
    }
  }

  // A depth guard is enough against cyclic files; real wrapper chains are one level deep.
  const resolveInternalRefs = (objectId: string, depth: number): FastMesh[] => {
    const refs = internalRefsByObjectId.get(objectId);
    if (!refs || depth >= MAX_COMPONENT_DEPTH) return [];
    const resolved: FastMesh[] = [];
    for (const ref of refs) {
      const target = objects.get(ref.refId);
      if (!target) continue;
      const targetMeshes = [...target.meshes, ...resolveInternalRefs(ref.refId, depth + 1)];
      for (const mesh of targetMeshes) {
        resolved.push({
          ...placeMesh(mesh, ref.transform),
          extruder: mesh.ownColor ? mesh.extruder : ref.extruder,
          // The component it's directly under: each level overwrites the one below.
          part: ref.part,
        });
      }
    }
    return resolved;
  };
  // Resolve everything before appending, or nested references get counted twice per level.
  const resolvedByObjectId = new Map<string, FastMesh[]>();
  const roots = forStudio ? new Set(placements.map((item) => item.objectId)) : internalRefsByObjectId.keys();
  for (const objectId of roots) {
    if (!internalRefsByObjectId.has(objectId)) continue;
    resolvedByObjectId.set(objectId, resolveInternalRefs(objectId, 0));
  }
  for (const [objectId, resolved] of resolvedByObjectId) {
    const object = objects.get(objectId);
    if (object) for (const mesh of resolved) object.meshes.push(mesh);
  }

  return objects;
}

type ParsedModel = {
  objects: Map<string, ObjectData>;
  buildItems: BuildItem[];
  plateNames: Map<number, string>;
  plateOffsets: Map<number, { offsetX: number; offsetY: number }>;
  plateThumbnails: Map<number, string>;
  plateIds: Set<number>;
  bed: BedBox | null;
  bedCenterOffset: [number, number];
  unitMm: number;
  projectFilaments: number;
  filamentColors: string[];
  buildVolume: { x: number; y: number };
  /** Part files the main model points to that aren't in the archive. */
  missingParts: number;
};

// Counted after expanding components and placements: a Bambu file's main model has almost none.
const MAX_TRIANGLES = 8_000_000;
// V8 can't hold a string past ~512MB. Checked from the zip's central directory before inflating.
const MAX_MODEL_ENTRY_BYTES = 500 * 1024 * 1024;
const MAX_MODEL_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_RELS_BYTES = 1024 * 1024;

/** "too-complex" is over budget (the browser mustn't try either); "unsupported" is a layout this
 * parser doesn't handle, which the browser's loaders may still manage. */
export type PreviewRefusal = "too-complex" | "unsupported";

async function readThreeMfStructure(srcPath: string, forStudio: boolean, includeThumbnails: boolean) {
  const entries = (await listZipEntries(srcPath)).filter((entry) => !entry.isDirectory);
  const names = entries.map((entry) => entry.name);
  const entryNamed = partNames(names);
  const projectSettingsName = entryNamed("Metadata/project_settings.config");
  const relsName = entryNamed("_rels/.rels");
  const rels = relsName ? await readZipEntry(srcPath, relsName, MAX_RELS_BYTES).catch(() => null) : null;
  const mainModelPath = findStartPart(names, rels?.toString("utf-8") ?? null);
  if (!mainModelPath) return "unsupported" as const;
  const modelEntries = entries.filter(
    (entry) => entry.name === mainModelPath || entry.name.toLowerCase().endsWith(".model"),
  );
  if (modelEntries.some((entry) => entry.size > MAX_MODEL_ENTRY_BYTES)) return "too-complex" as const;
  if (modelEntries.reduce((sum, entry) => sum + entry.size, 0) > MAX_MODEL_TOTAL_BYTES) return "too-complex" as const;

  let modelSettingsText: string | null = null;
  let projectSettingsText: string | null = null;
  let mainModelText: string | null = null;
  const plateJsonEntries: { plateIndex: number; text: string }[] = [];
  const plateThumbBytes = new Map<number, Buffer>();

  await walkZipEntries(
    srcPath,
    (entry) => {
      if (entry.name === "Metadata/model_settings.config") return true;
      if (entry.name === projectSettingsName) return true;
      if (entry.name === mainModelPath) return true;
      if (/^Metadata\/plate_\d+\.json$/.test(entry.name)) return true;
      if (includeThumbnails && /^Metadata\/(plate|top)_\d+\.png$/.test(entry.name)) return true;
      return false;
    },
    async (entry, stream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
      const buf = Buffer.concat(chunks);

      if (entry.name === "Metadata/model_settings.config") modelSettingsText = buf.toString("utf-8");
      else if (entry.name === projectSettingsName) projectSettingsText = buf.toString("utf-8");
      else if (entry.name === mainModelPath) mainModelText = buf.toString("utf-8");
      else {
        const plateMatch = entry.name.match(/^Metadata\/plate_(\d+)\.json$/);
        if (plateMatch)
          plateJsonEntries.push({ plateIndex: Number.parseInt(plateMatch[1], 10), text: buf.toString("utf-8") });
        const thumbMatch = entry.name.match(/^Metadata\/(?:plate|top)_(\d+)\.png$/);
        if (thumbMatch) {
          const idx = Number.parseInt(thumbMatch[1], 10);
          // "plate_N" takes priority over "top_N".
          if (!plateThumbBytes.has(idx)) plateThumbBytes.set(idx, buf);
        }
      }
    },
  );

  if (!mainModelText) return "unsupported" as const;
  const mainModelXml: string = mainModelText;

  const structural = modelSettingsText ? parseModelSettingsConfig(modelSettingsText) : parseModelSettingsConfig("");
  const project = projectSettingsText
    ? parseProjectSettingsJson(projectSettingsText)
    : { filamentColors: [], buildVolume: null, bed: null };
  // Fallback for files MakerWorld didn't slice: plate_N.json keyed by object name.
  const plateAssignmentsByName = new Map<string, number>();
  for (const { plateIndex, text } of plateJsonEntries) {
    try {
      const json = JSON.parse(text) as { bbox_objects?: { name?: string }[] };
      for (const entry of json.bbox_objects ?? []) {
        if (entry?.name) plateAssignmentsByName.set(entry.name, plateIndex);
      }
    } catch {}
  }
  const allObjects = readMainObjects(mainModelXml, structural, forStudio);
  const placements = readMainPlacements(mainModelXml, forStudio);
  for (const item of placements) {
    const objectAttrs = allObjects.get(item.objectId)?.attrs;
    const objectName = readObjectName(structural, item.objectId, objectAttrs);
    item.plateId =
      findPlateIdAttr(item.attrs) ??
      structural.plateAssignmentsByInstance.get(`${item.objectId}:${item.instance}`) ??
      (objectAttrs ? findPlateIdAttr(objectAttrs) : null) ??
      structural.plateAssignmentsByObjectId.get(item.objectId) ??
      (objectName ? plateAssignmentsByName.get(objectName) : null) ??
      null;
  }
  return { entryNamed, mainModelXml, structural, project, plateThumbBytes, allObjects, placements };
}

/** Build-plate metadata, before opening the geometry entries referenced by the placements. */
export async function readThreeMfBuildPlates(srcPath: string, forStudio = false) {
  const data = await readThreeMfStructure(srcPath, forStudio, false);
  if (typeof data === "string") return data;
  const counts = new Map<number | null, number>();
  for (const { plateId, objectId } of data.placements) {
    if (data.allObjects.has(objectId)) counts.set(plateId, (counts.get(plateId) ?? 0) + 1);
  }
  if (!counts.size) return "unsupported" as const;
  return [...counts]
    .toSorted(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([index, objectCount]): ThreeMfBuildPlate => ({
      index,
      name: index === null ? null : (data.structural.plateNames.get(index) ?? null),
      objectCount,
      thumbnail:
        index !== null &&
        Boolean(data.entryNamed(`Metadata/plate_${index}.png`) || data.entryNamed(`Metadata/top_${index}.png`)),
    }));
}

async function parseThreeMfFast(
  srcPath: string,
  studioMaxTriangles?: number,
  selectedPlate?: { index: number | null },
): Promise<ParsedModel | PreviewRefusal> {
  const forStudio = studioMaxTriangles !== undefined;
  const data = await readThreeMfStructure(srcPath, forStudio, !forStudio && !selectedPlate);
  if (typeof data === "string") return data;
  const { entryNamed, mainModelXml, structural, project, plateThumbBytes, allObjects } = data;
  const { buildVolume, bed } = project;
  // A project's filament slots come first, then colours declared by each model part.
  const filamentColors = [...project.filamentColors];
  const colors = sharePalette(filamentColors, readColorGroups(mainModelXml));

  const externalModelCache = new Map<string, string | null>();
  let missingParts = 0;
  const loadExternalModel = async (rawPath: string): Promise<string | null> => {
    const normalized = entryNamed(rawPath) ?? (rawPath.startsWith("/") ? rawPath.slice(1) : rawPath);
    if (externalModelCache.has(normalized)) return externalModelCache.get(normalized) ?? null;
    const buf = await readZipEntry(srcPath, normalized, MAX_MODEL_ENTRY_BYTES);
    const text = buf ? buf.toString("utf-8") : null;
    externalModelCache.set(normalized, text);
    if (text === null) missingParts++;
    return text;
  };

  // Before any geometry is allocated, so an over-budget file fails cheaply.
  const placements = selectedPlate
    ? data.placements.filter((item) => item.plateId === selectedPlate.index)
    : data.placements;
  const mainObjects = forStudio || selectedPlate ? studioMainObjects(allObjects, placements) : allObjects;
  const partFiles = createPartFileResolver(loadExternalModel, filamentColors);
  if ((await countRenderedTriangles(mainObjects, placements, partFiles)) > (studioMaxTriangles ?? MAX_TRIANGLES))
    return "too-complex";

  const objects = await parseMainModel(
    mainObjects,
    placements,
    structural,
    partFiles,
    colors,
    forStudio || Boolean(selectedPlate),
  );
  if (objects.size === 0) return "unsupported";

  const plateThumbnails = new Map<number, string>();
  for (const [idx, bytes] of plateThumbBytes) {
    plateThumbnails.set(idx, `data:image/png;base64,${bytes.toString("base64")}`);
  }

  return {
    objects,
    buildItems: placements,
    plateNames: structural.plateNames,
    plateOffsets: structural.plateOffsets,
    plateThumbnails,
    plateIds: selectedPlate
      ? new Set([
          ...structural.plateIds,
          ...data.placements.flatMap((item) => (item.plateId === null ? [] : [item.plateId])),
        ])
      : structural.plateIds,
    bed,
    bedCenterOffset: structural.bedCenterOffset,
    unitMm:
      ({ micron: 0.001, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 } as Record<string, number>)[
        getAttr(mainModelXml.match(/<model\b([^>]*)>/)?.[1] ?? "", "unit") ?? ""
      ] ?? 1,
    projectFilaments: project.filamentColors.length,
    filamentColors,
    buildVolume: buildVolume ?? { x: 256, y: 256 },
    missingParts,
  };
}

/** Merges meshes per (plate, extruder), so the viewer only toggles plate visibility. */
async function buildGlbGroup(parsed: ParsedModel): Promise<import("three").Group> {
  const THREE = await import("three");
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

  const objectCountByPlate = new Map<number, number>();
  for (const item of parsed.buildItems) {
    if (item.plateId == null) continue;
    objectCountByPlate.set(item.plateId, (objectCountByPlate.get(item.plateId) ?? 0) + 1);
  }
  const plateIndexes = Array.from(objectCountByPlate.keys()).toSorted((a, b) => a - b);
  const hasPlateAssignments = plateIndexes.length > 0;
  // No plate metadata: put everything under a synthetic plate 0.
  const effectivePlateIndexes = hasPlateAssignments ? plateIndexes : [0];

  const root = new THREE.Group();
  root.name = "thingport-preview-root";

  const plates: PlateSummary[] = [];
  for (const plateIndex of effectivePlateIndexes) {
    const itemsForPlate = hasPlateAssignments
      ? parsed.buildItems.filter((item) => item.plateId === plateIndex)
      : parsed.buildItems;

    const geometriesByExtruder = new Map<number, InstanceType<typeof THREE.BufferGeometry>[]>();
    for (const item of itemsForPlate) {
      const objectData = parsed.objects.get(item.objectId);
      if (!objectData) continue;
      for (const mesh of objectData.meshes) {
        const positioned = item.transform ? applyAffineToVertices(mesh.vertices, item.transform) : mesh.vertices;
        // 3MF Z-up -> three.js Y-up, matching bambuThreeMf.ts's createGeometryFromMesh.
        // Changing this changes every cached GLB: bump PREVIEW_FORMAT_VERSION.
        const swapped = new Float32Array(positioned.length);
        for (let i = 0; i < positioned.length; i += 3) {
          swapped[i] = positioned[i];
          swapped[i + 1] = positioned[i + 2];
          swapped[i + 2] = -positioned[i + 1];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(swapped, 3));
        geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
        geometry.computeVertexNormals();
        if (!geometriesByExtruder.has(mesh.extruder)) geometriesByExtruder.set(mesh.extruder, []);
        geometriesByExtruder.get(mesh.extruder)!.push(geometry);
      }
    }

    const plateGroup = new THREE.Group();
    plateGroup.name = `plate-${plateIndex}`;
    // Every plate stays visible: GLTFExporter drops invisible nodes by default.
    let objectCount = 0;
    const fallbackColor = new THREE.Color(0xdddddd);
    for (const [extruder, geometries] of geometriesByExtruder) {
      if (geometries.length === 0) continue;
      // Type-only mismatch between mergeGeometries' .d.ts and the dynamically imported three.
      const merged =
        geometries.length === 1
          ? geometries[0]
          : (mergeGeometries(geometries as never, false) as InstanceType<typeof THREE.BufferGeometry> | null);
      if (merged) {
        const colorStr = parsed.filamentColors[extruder];
        const color = colorStr ? new THREE.Color(colorStr) : fallbackColor;
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.0 });
        const mesh = new THREE.Mesh(merged as never, material);
        mesh.name = `extruder-${extruder}`;
        plateGroup.add(mesh);
        objectCount++;
      }
      if (geometries.length > 1) geometries.forEach((g) => g.dispose());
    }
    root.add(plateGroup);
    plates.push({ index: plateIndex, name: parsed.plateNames.get(plateIndex) ?? null, objectCount });
  }

  root.userData = {
    thingportPreview: JSON.stringify({
      plates,
      plateThumbnails: Object.fromEntries(parsed.plateThumbnails),
      filamentColors: parsed.filamentColors,
      buildVolume: parsed.buildVolume,
    }),
  };

  return root;
}

// Meshes this small aren't worth simplifying and would lose their shape.
const SIMPLIFY_MIN_MESH_TRIANGLES = 2_000;
// Maximum shape deviation as a fraction of the mesh's size.
const SIMPLIFY_MAX_ERROR = 0.01;
const UNUSED_VERTEX = 0xffffffff;

type StudioThreeMfPart = { name: string | null; color?: string; triangles: Float32Array };

/** The build items as placed in their own plates, before the preview path joins them by filament. */
export async function loadStudioThreeMf(
  srcPath: string,
  maxTriangles: number,
  maxObjects: number,
  maxBodyTriangles = maxTriangles,
  selectedPlate?: { index: number | null },
): Promise<
  | { plates: { name: string | null; parts: StudioThreeMfPart[] }[]; mixedColors: boolean }
  | PreviewRefusal
  | "missing-parts"
  | "body-too-complex"
> {
  const parsed = await parseThreeMfFast(srcPath, maxTriangles, selectedPlate);
  if (typeof parsed === "string") return parsed;
  if (parsed.missingParts) return "missing-parts";
  const items = parsed.buildItems.filter((item) => parsed.objects.get(item.objectId)?.meshes.length);
  if (!items.length) return "unsupported";
  if (items.length > maxObjects) return "too-complex";

  const groups = new Map<number | null, StudioThreeMfPart[]>();
  let mixedColors = false;
  let bodyCount = 0;
  const colorOf = (mesh: FastMesh) =>
    (mesh.ownColor || mesh.extruder < parsed.projectFilaments ? parsed.filamentColors[mesh.extruder] : "") || undefined;
  for (const item of items) {
    const object = parsed.objects.get(item.objectId)!;
    const flip = item.transform && mirrors(item.transform);
    const body = (meshes: FastMesh[], name: string | null): StudioThreeMfPart | "body-too-complex" | "unsupported" => {
      const indexCount = meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0);
      if (indexCount / 3 > maxBodyTriangles) return "body-too-complex";
      const triangles = new Float32Array(indexCount * 3);
      const colors = new Set(meshes.map(colorOf));
      let at = 0;
      for (const mesh of meshes) {
        const vertices = item.transform ? applyAffineToVertices(mesh.vertices, item.transform) : mesh.vertices;
        const indices = mesh.triangles;
        for (let i = 0; i < indices.length; i += 3) {
          for (let corner = 0; corner < 3; corner++) {
            const vertex = 3 * indices[i + (flip && corner !== 0 ? 3 - corner : corner)];
            for (let axis = 0; axis < 3; axis++) triangles[at++] = vertices[vertex + axis] * parsed.unitMm;
          }
        }
      }
      if (!triangles.every(Number.isFinite)) return "unsupported";
      if (colors.size > 1) mixedColors = true;
      return { name, color: colors.size === 1 ? colors.values().next().value : undefined, triangles };
    };
    // An object of several parts, each one colour, comes in as those parts, each its colour: how a multi-colour
    // model is kept, and how Studio writes bodies that touch, which come back as the bodies they were (each within
    // the body limit, as it was exported). Faces painted another colour stay on their body.
    const byPart = new Map<string | undefined, FastMesh[]>();
    for (const mesh of object.meshes) {
      const meshes = byPart.get(mesh.part?.key);
      if (meshes) meshes.push(mesh);
      else byPart.set(mesh.part?.key, [mesh]);
    }
    const partColors = [...byPart.values()].map((meshes) => new Set(meshes.map(colorOf)));
    const split = partColors.length > 1 && partColors.every((colors) => colors.size === 1);
    const bodies = split
      ? [...byPart.values()].map((meshes) => body(meshes, meshes[0].part?.name ?? object.name))
      : [body(object.meshes, object.name)];
    for (const part of bodies) {
      if (typeof part === "string") return part;
      const group = groups.get(item.plateId);
      if (group) group.push(part);
      else groups.set(item.plateId, [part]);
    }
    bodyCount += bodies.length;
  }
  if (bodyCount > maxObjects) return "too-complex";

  const plateIds = [...new Set([...parsed.plateIds, ...groups.keys()])]
    .filter((id) => id !== null)
    .toSorted((a, b) => a - b);
  const plates = [...groups]
    .toSorted(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([id, parts]) => {
      const bed = parsed.bed;
      if (bed && id !== null) {
        const [cx, cy] = bedCentre(bed);
        const [gx, gy] = plateOrigin(plateIds.indexOf(id), plateColumns(plateIds.length), bed);
        const offset = parsed.plateOffsets.get(id);
        const [dx, dy] = parsed.bedCenterOffset;
        const x = cx + dx + (offset?.offsetX ?? gx);
        const y = cy + dy + (offset?.offsetY ?? gy);
        for (const { triangles } of parts) {
          for (let i = 0; i < triangles.length; i += 3) {
            triangles[i] -= x;
            triangles[i + 1] -= y;
          }
        }
      } else {
        // Generic 3MF has no bed coordinates. Center its layout as a group, preserving distances between objects.
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity];
        for (const { triangles } of parts) {
          for (let i = 0; i < triangles.length; i += 3) {
            min[0] = Math.min(min[0], triangles[i]);
            min[1] = Math.min(min[1], triangles[i + 1]);
            min[2] = Math.min(min[2], triangles[i + 2]);
            max[0] = Math.max(max[0], triangles[i]);
            max[1] = Math.max(max[1], triangles[i + 1]);
          }
        }
        const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
        for (const { triangles } of parts) {
          for (let i = 0; i < triangles.length; i++) triangles[i] -= center[i % 3];
        }
      }
      return { name: id === null ? null : (parsed.plateNames.get(id) ?? null), parts };
    });
  return { plates, mixedColors };
}

/** The 3MF as a three.js group, one child group per plate, already turned Y-up. */
export async function loadThreeMfGroup(srcPath: string): Promise<import("three").Group | PreviewRefusal> {
  const parsed = await parseThreeMfFast(srcPath);
  if (typeof parsed === "string") return parsed;
  return buildGlbGroup(parsed);
}

/** Each placed object's meshes once, untransformed, for the printability check (meshQuality.ts). */
export async function loadThreeMfMeshes(
  srcPath: string,
): Promise<{ meshes: { vertices: Float32Array; triangles: Uint32Array }[]; missingParts: number } | PreviewRefusal> {
  const parsed = await parseThreeMfFast(srcPath);
  if (typeof parsed === "string") return parsed;
  const placed = new Set(parsed.buildItems.map((item) => item.objectId));
  const meshes = [...placed].flatMap((id) => parsed.objects.get(id)?.meshes ?? []);
  return { meshes, missingParts: parsed.missingParts };
}

export type SimplifiedSummary = { from: number; to: number };

function meshTriangleCount(mesh: import("three").Mesh): number {
  return (mesh.geometry.index?.count ?? 0) / 3;
}

/** Simplifies merged meshes in place when their total exceeds `budget` triangles; null when
 *  already within budget. Only indexed meshes are simplified. */
export async function simplifyGroupMeshes(
  root: import("three").Group,
  budget: number,
): Promise<SimplifiedSummary | null> {
  const THREE = await import("three");
  const meshes: InstanceType<typeof THREE.Mesh>[] = [];
  root.traverse((obj) => {
    if ((obj as InstanceType<typeof THREE.Mesh>).isMesh) meshes.push(obj as InstanceType<typeof THREE.Mesh>);
  });
  const total = meshes.reduce((sum, mesh) => sum + meshTriangleCount(mesh), 0);
  if (total <= budget) return null;

  // ESM-only; the CommonJS build's require() loads ES modules from Node 20.19 (see engines).
  const { MeshoptSimplifier } = await import("meshoptimizer");
  await MeshoptSimplifier.ready;

  let after = 0;
  for (const mesh of meshes) {
    const count = meshTriangleCount(mesh);
    const index = mesh.geometry.index;
    if (!index || count <= SIMPLIFY_MIN_MESH_TRIANGLES) {
      after += count;
      continue;
    }
    const target = Math.max(SIMPLIFY_MIN_MESH_TRIANGLES, Math.floor((count * budget) / total));
    const positions = mesh.geometry.getAttribute("position").array as Float32Array;
    const indices = index.array instanceof Uint32Array ? index.array : Uint32Array.from(index.array);
    const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, target * 3, SIMPLIFY_MAX_ERROR, [
      "LockBorder",
    ]);
    // Drop unused vertices so the GLB actually gets smaller.
    const [remap, uniqueVertices] = MeshoptSimplifier.compactMesh(simplified);
    const compacted = new Float32Array(uniqueVertices * 3);
    for (let oldIndex = 0; oldIndex < remap.length; oldIndex++) {
      const newIndex = remap[oldIndex];
      if (newIndex === UNUSED_VERTEX) continue;
      compacted[newIndex * 3] = positions[oldIndex * 3];
      compacted[newIndex * 3 + 1] = positions[oldIndex * 3 + 1];
      compacted[newIndex * 3 + 2] = positions[oldIndex * 3 + 2];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(compacted, 3));
    geometry.setIndex(new THREE.BufferAttribute(simplified, 1));
    geometry.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    after += simplified.length / 3;
  }
  return { from: total, to: after };
}

export type RenderOptions = {
  /** Null keeps the exact geometry. */
  simplifyTo: number | null;
  buildPlate?: number;
};

export async function renderModelPreviewGlb(
  srcPath: string,
  destPath: string,
  options: RenderOptions = { simplifyTo: null },
): Promise<"ok" | PreviewRefusal> {
  const parsed = await parseThreeMfFast(
    srcPath,
    undefined,
    options.buildPlate === undefined ? undefined : { index: options.buildPlate },
  );
  if (typeof parsed === "string") return parsed;
  const group = await buildGlbGroup(parsed);
  if (options.simplifyTo) {
    const simplified = await simplifyGroupMeshes(group, options.simplifyTo);
    // Lets a later settings change find affected previews without re-rendering them.
    if (simplified) {
      const meta = JSON.parse(group.userData.thingportPreview as string) as Record<string, unknown>;
      group.userData.thingportPreview = JSON.stringify({ ...meta, simplified });
    }
  }
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const result = await new GLTFExporter().parseAsync(group, { binary: true });
  await fs.writeFile(destPath, Buffer.from(result as ArrayBuffer));
  return "ok";
}
