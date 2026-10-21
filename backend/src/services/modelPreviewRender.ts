import fs from "node:fs/promises";
import * as cheerio from "cheerio";
import { listZipEntries, readZipEntry, walkZipEntries } from "../utils/zipReader";

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

function getAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Different Bambu Studio versions spell it plate_id or plater_id. */
function findPlateIdAttr(attrs: string): number | null {
  const m = attrs.match(/(?:^|\s)(?:[\w-]+:)?(?:plate_id|plater_id|plateid|platerid)="([^"]*)"/i);
  if (!m) return null;
  const parsed = Number.parseInt(m[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 3MF's 3x4 affine transform: [m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz]. */
function parseTransform3MF(str: string | null): number[] | null {
  if (!str) return null;
  const v = str.trim().split(/\s+/).map(Number);
  return v.length >= 12 ? v : null;
}

function applyAffineToVertices(vertices: Float32Array, t: number[]): Float32Array {
  const out = new Float32Array(vertices.length);
  const [t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11] = t;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    out[i] = t0 * x + t1 * y + t2 * z + t9;
    out[i + 1] = t3 * x + t4 * y + t5 * z + t10;
    out[i + 2] = t6 * x + t7 * y + t8 * z + t11;
  }
  return out;
}

type FastMesh = { vertices: Float32Array; triangles: Uint32Array; extruder: number };

const MESH_RE = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/g;
const VERTEX_RE = /<vertex\s+x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"/g;
const TRIANGLE_RE = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;

/** Extracts every <mesh>'s vertices/triangles via regex, without building a DOM. */
function extractMeshesFast(xml: string, extruder: number): FastMesh[] {
  const meshes: FastMesh[] = [];
  MESH_RE.lastIndex = 0;
  let meshMatch: RegExpExecArray | null;
  while ((meshMatch = MESH_RE.exec(xml))) {
    const inner = meshMatch[1];
    const vertices: number[] = [];
    VERTEX_RE.lastIndex = 0;
    let vm: RegExpExecArray | null;
    while ((vm = VERTEX_RE.exec(inner))) {
      vertices.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]));
    }
    const triangles: number[] = [];
    TRIANGLE_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = TRIANGLE_RE.exec(inner))) {
      triangles.push(parseInt(tm[1], 10), parseInt(tm[2], 10), parseInt(tm[3], 10));
    }
    if (vertices.length > 0 && triangles.length > 0) {
      meshes.push({ vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles), extruder });
    }
  }
  return meshes;
}

type ObjectData = { id: string; meshes: FastMesh[]; plateId: number | null };
type BuildItem = { objectId: string; transform: number[] | null; plateId: number | null };
export type PlateSummary = { index: number; name: string | null; objectCount: number };

type StructuralData = {
  extruderMapById: Map<string, number>;
  partExtruderMap: Map<string, number>;
  objectNameById: Map<string, string>;
  plateAssignmentsByObjectId: Map<string, number>;
  plateNames: Map<number, string>;
  plateOffsets: Map<number, { offsetX: number; offsetY: number }>;
};

function parseModelSettingsConfig(xml: string): StructuralData {
  const data: StructuralData = {
    extruderMapById: new Map(),
    partExtruderMap: new Map(),
    objectNameById: new Map(),
    plateAssignmentsByObjectId: new Map(),
    plateNames: new Map(),
    plateOffsets: new Map(),
  };
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(xml, { xml: true });
  } catch {
    return data;
  }

  $("object").each((_i, objEl) => {
    const $obj = $(objEl);
    const objectId = $obj.attr("id");
    if (!objectId) return;

    const extruderMeta = $obj.children('metadata[key="extruder"]').first();
    const extruderVal = extruderMeta.attr("value");
    if (extruderVal) data.extruderMapById.set(objectId, Math.max(0, parseInt(extruderVal, 10) - 1));

    const nameVal = $obj.children('metadata[key="name"]').first().attr("value");
    if (nameVal) data.objectNameById.set(objectId, nameVal);

    $obj.find("part").each((_j, partEl) => {
      const $part = $(partEl);
      const partId = $part.attr("id");
      if (!partId) return;
      const partExtruderVal = $part.children('metadata[key="extruder"]').first().attr("value");
      if (partExtruderVal)
        data.partExtruderMap.set(`${objectId}:${partId}`, Math.max(0, parseInt(partExtruderVal, 10) - 1));
    });
  });

  $("plate").each((_i, plateEl) => {
    const $plate = $(plateEl);
    let plateId: number | null = null;
    let offsetX = 0;
    let offsetY = 0;
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
    if (offsetX !== 0 || offsetY !== 0) data.plateOffsets.set(plateId, { offsetX, offsetY });
    if (plateName) data.plateNames.set(plateId, plateName);

    $plate.find("model_instance").each((_j, instEl) => {
      const objectIdVal = $(instEl).children('metadata[key="object_id"]').first().attr("value");
      if (objectIdVal) data.plateAssignmentsByObjectId.set(objectIdVal, plateId as number);
    });
  });

  return data;
}

function parseProjectSettingsJson(text: string): {
  filamentColors: string[];
  buildVolume: { x: number; y: number } | null;
} {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const filamentColors = Array.isArray(json.filament_colour)
      ? json.filament_colour.filter((c): c is string => typeof c === "string")
      : [];
    let buildVolume: { x: number; y: number } | null = null;
    const area = json.printable_area;
    if (Array.isArray(area) && area.length >= 3 && typeof area[2] === "string") {
      const match = area[2].match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
      if (match) buildVolume = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
    }
    return { filamentColors, buildVolume };
  } catch {
    return { filamentColors: [], buildVolume: null };
  }
}

const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*)\/?>/g;
const ITEM_RE = /<item\b([^>]*)\/?>/g;

type InternalComponentRef = { refId: string; transform: number[] | null; extruder: number };

const MAX_COMPONENT_DEPTH = 8;

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
 * objectid, so a component takes only the object it names.
 *
 * Uses its own regex instances: callers are mid-way through a global OBJECT_RE/COMPONENT_RE scan. */
function createPartFileResolver(loadExternalModel: (path: string) => Promise<string | null>) {
  const objectsByPath = new Map<string, Map<string, string> | null>();
  const meshCache = new Map<string, FastMesh[]>();
  const countCache = new Map<string, number>();

  const objectsIn = async (path: string): Promise<Map<string, string> | null> => {
    if (objectsByPath.has(path)) return objectsByPath.get(path)!;
    const xml = await loadExternalModel(path);
    let objects: Map<string, string> | null = null;
    if (xml) {
      objects = new Map();
      const objectRe = new RegExp(OBJECT_RE.source, "g");
      let om: RegExpExecArray | null;
      while ((om = objectRe.exec(xml))) {
        const id = getAttr(om[1], "id");
        if (id) objects.set(id, om[2]);
      }
    }
    objectsByPath.set(path, objects);
    return objects;
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
  const objectMeshes = async (
    path: string,
    objects: Map<string, string>,
    id: string,
    depth: number,
  ): Promise<FastMesh[]> => {
    const key = `${path}#${id}`;
    const cached = meshCache.get(key);
    if (cached) return cached;
    const inner = objects.get(id) ?? "";
    const meshes = extractMeshesFast(inner, 0);
    if (depth < MAX_COMPONENT_DEPTH) {
      for (const ref of innerRefs(inner, objects)) {
        for (const mesh of await objectMeshes(path, objects, ref.refId, depth + 1)) {
          meshes.push(
            ref.transform ? { ...mesh, vertices: applyAffineToVertices(mesh.vertices, ref.transform) } : mesh,
          );
        }
      }
    }
    meshCache.set(key, meshes);
    return meshes;
  };

  const objectTriangles = (path: string, objects: Map<string, string>, id: string, depth: number): number => {
    const key = `${path}#${id}`;
    const cached = countCache.get(key);
    if (cached !== undefined) return cached;
    const inner = objects.get(id) ?? "";
    let count = countTriangleTags(inner);
    if (depth < MAX_COMPONENT_DEPTH) {
      for (const ref of innerRefs(inner, objects)) count += objectTriangles(path, objects, ref.refId, depth + 1);
    }
    countCache.set(key, count);
    return count;
  };

  return {
    async meshes(path: string, objectId: string | null): Promise<FastMesh[]> {
      const objects = await objectsIn(path);
      if (!objects) return [];
      const out: FastMesh[] = [];
      for (const id of partFileTargetIds(objects, objectId)) out.push(...(await objectMeshes(path, objects, id, 0)));
      return out;
    },
    async triangles(path: string, objectId: string | null): Promise<number> {
      const objects = await objectsIn(path);
      if (!objects) return 0;
      return partFileTargetIds(objects, objectId).reduce((sum, id) => sum + objectTriangles(path, objects, id, 0), 0);
    },
  };
}

type PartFileResolver = ReturnType<typeof createPartFileResolver>;

/** Triangles the preview would materialize after expanding components and placements, counted
 * from tags so an over-budget file never allocates its geometry. */
async function countRenderedTriangles(xml: string, partFiles: PartFileResolver): Promise<number> {
  const ownCount = new Map<string, number>();
  const internalRefs = new Map<string, string[]>();

  OBJECT_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  while ((om = OBJECT_RE.exec(xml))) {
    const objectId = getAttr(om[1], "id");
    if (!objectId) continue;
    const inner = om[2];
    let count = countTriangleTags(inner);
    const refs: string[] = [];
    COMPONENT_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = COMPONENT_RE.exec(inner))) {
      const cAttrs = cm[1];
      const extPath = getAttr(cAttrs, "p:path") ?? getAttr(cAttrs, "path");
      const compObjectId = getAttr(cAttrs, "objectid");
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

  let rendered = 0;
  const buildMatch = xml.match(/<build\b[\s\S]*?<\/build>/);
  if (buildMatch) {
    ITEM_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = ITEM_RE.exec(buildMatch[0]))) {
      const objectId = getAttr(im[1], "objectid");
      if (objectId) rendered += totalFor(objectId, 0);
    }
  }
  return rendered;
}

async function parseMainModel(
  xml: string,
  structural: StructuralData,
  plateAssignmentsByName: Map<string, number>,
  partFiles: PartFileResolver,
): Promise<{ objects: Map<string, ObjectData>; buildItems: BuildItem[] }> {
  const objects = new Map<string, ObjectData>();
  // A <component> without p:path references another <object> in this document. Order isn't
  // guaranteed, so these are resolved in a second pass.
  const internalRefsByObjectId = new Map<string, InternalComponentRef[]>();

  OBJECT_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  while ((om = OBJECT_RE.exec(xml))) {
    const attrs = om[1];
    const inner = om[2];
    const objectId = getAttr(attrs, "id");
    if (!objectId) continue;

    const objectPlateId = findPlateIdAttr(attrs) ?? structural.plateAssignmentsByObjectId.get(objectId) ?? null;
    let defaultExtruder = structural.extruderMapById.get(objectId) ?? -1;
    if (defaultExtruder < 0) {
      const extruderAttr = getAttr(attrs, "p:extruder") ?? getAttr(attrs, "extruder") ?? "1";
      defaultExtruder = Math.max(0, parseInt(extruderAttr, 10) - 1);
    }

    const meshes = extractMeshesFast(inner, defaultExtruder);

    COMPONENT_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = COMPONENT_RE.exec(inner))) {
      const cAttrs = cm[1];
      const extPath = getAttr(cAttrs, "p:path") ?? getAttr(cAttrs, "path");
      const compObjectId = getAttr(cAttrs, "objectid");
      const transform = parseTransform3MF(getAttr(cAttrs, "transform"));
      const partKey = compObjectId ? `${objectId}:${compObjectId}` : null;
      const compExtruder = partKey ? (structural.partExtruderMap.get(partKey) ?? defaultExtruder) : defaultExtruder;

      if (extPath) {
        for (const mesh of await partFiles.meshes(extPath, compObjectId)) {
          meshes.push({
            vertices: transform ? applyAffineToVertices(mesh.vertices, transform) : mesh.vertices,
            triangles: mesh.triangles,
            extruder: compExtruder,
          });
        }
      } else if (compObjectId) {
        if (!internalRefsByObjectId.has(objectId)) internalRefsByObjectId.set(objectId, []);
        internalRefsByObjectId.get(objectId)!.push({ refId: compObjectId, transform, extruder: compExtruder });
      }
    }

    // Keep pure wrapper objects too: they need an entry for the resolution pass.
    if (meshes.length > 0 || internalRefsByObjectId.has(objectId)) {
      objects.set(objectId, { id: objectId, meshes, plateId: objectPlateId });
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
          vertices: ref.transform ? applyAffineToVertices(mesh.vertices, ref.transform) : mesh.vertices,
          triangles: mesh.triangles,
          extruder: ref.extruder,
        });
      }
    }
    return resolved;
  };
  // Resolve everything before appending, or nested references get counted twice per level.
  const resolvedByObjectId = new Map<string, FastMesh[]>();
  for (const objectId of internalRefsByObjectId.keys()) {
    resolvedByObjectId.set(objectId, resolveInternalRefs(objectId, 0));
  }
  for (const [objectId, resolved] of resolvedByObjectId) {
    const object = objects.get(objectId);
    if (object) for (const mesh of resolved) object.meshes.push(mesh);
  }

  const buildItems: BuildItem[] = [];
  const buildMatch = xml.match(/<build\b[\s\S]*?<\/build>/);
  if (buildMatch) {
    ITEM_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = ITEM_RE.exec(buildMatch[0]))) {
      const attrs = im[1];
      const objectId = getAttr(attrs, "objectid");
      if (!objectId) continue;
      const transform = parseTransform3MF(getAttr(attrs, "transform"));
      const itemPlateId = findPlateIdAttr(attrs);
      const objectPlateId = objects.get(objectId)?.plateId ?? null;
      const objectName = structural.objectNameById.get(objectId);
      const namePlateId = objectName ? (plateAssignmentsByName.get(objectName) ?? null) : null;
      buildItems.push({ objectId, transform, plateId: itemPlateId ?? objectPlateId ?? namePlateId ?? null });
    }
  }

  return { objects, buildItems };
}

type ParsedModel = {
  objects: Map<string, ObjectData>;
  buildItems: BuildItem[];
  plateNames: Map<number, string>;
  plateOffsets: Map<number, { offsetX: number; offsetY: number }>;
  plateThumbnails: Map<number, string>;
  filamentColors: string[];
  buildVolume: { x: number; y: number };
  /** Part files the main model points to that aren't in the archive. */
  missingParts: number;
};

const MAIN_MODEL_PATH = "3D/3dmodel.model";
// Counted after expanding components and placements: a Bambu file's main model has almost none.
const MAX_TRIANGLES = 8_000_000;
// V8 can't hold a string past ~512MB. Checked from the zip's central directory before inflating.
const MAX_MODEL_ENTRY_BYTES = 500 * 1024 * 1024;
const MAX_MODEL_TOTAL_BYTES = 1024 * 1024 * 1024;

/** "too-complex" is over budget (the browser mustn't try either); "unsupported" is a layout this
 * parser doesn't handle, which the browser's loaders may still manage. */
export type PreviewRefusal = "too-complex" | "unsupported";

async function parseThreeMfFast(srcPath: string): Promise<ParsedModel | PreviewRefusal> {
  const modelEntries = (await listZipEntries(srcPath)).filter(
    (entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".model"),
  );
  if (!modelEntries.some((entry) => entry.name === MAIN_MODEL_PATH)) return "unsupported";
  if (modelEntries.some((entry) => entry.size > MAX_MODEL_ENTRY_BYTES)) return "too-complex";
  if (modelEntries.reduce((sum, entry) => sum + entry.size, 0) > MAX_MODEL_TOTAL_BYTES) return "too-complex";

  let modelSettingsText: string | null = null;
  let projectSettingsText: string | null = null;
  let mainModelText: string | null = null;
  const plateJsonEntries: { plateIndex: number; text: string }[] = [];
  const plateThumbBytes = new Map<number, Buffer>();

  await walkZipEntries(
    srcPath,
    (entry) => {
      if (entry.name === "Metadata/model_settings.config") return true;
      if (entry.name === "Metadata/project_settings.config") return true;
      if (entry.name === MAIN_MODEL_PATH) return true;
      if (/^Metadata\/plate_\d+\.json$/.test(entry.name)) return true;
      if (/^Metadata\/(plate|top)_\d+\.png$/.test(entry.name)) return true;
      return false;
    },
    async (entry, stream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
      const buf = Buffer.concat(chunks);

      if (entry.name === "Metadata/model_settings.config") modelSettingsText = buf.toString("utf-8");
      else if (entry.name === "Metadata/project_settings.config") projectSettingsText = buf.toString("utf-8");
      else if (entry.name === MAIN_MODEL_PATH) mainModelText = buf.toString("utf-8");
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

  if (!mainModelText) return "unsupported";
  const mainModelXml: string = mainModelText;

  const structural = modelSettingsText ? parseModelSettingsConfig(modelSettingsText) : parseModelSettingsConfig("");
  const { filamentColors, buildVolume } = projectSettingsText
    ? parseProjectSettingsJson(projectSettingsText)
    : { filamentColors: [], buildVolume: null };

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

  const externalModelCache = new Map<string, string | null>();
  let missingParts = 0;
  const loadExternalModel = async (rawPath: string): Promise<string | null> => {
    const normalized = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
    if (externalModelCache.has(normalized)) return externalModelCache.get(normalized) ?? null;
    const buf = await readZipEntry(srcPath, normalized, MAX_MODEL_ENTRY_BYTES);
    const text = buf ? buf.toString("utf-8") : null;
    externalModelCache.set(normalized, text);
    if (text === null) missingParts++;
    return text;
  };

  // Before any geometry is allocated, so an over-budget file fails cheaply.
  const partFiles = createPartFileResolver(loadExternalModel);
  if ((await countRenderedTriangles(mainModelXml, partFiles)) > MAX_TRIANGLES) return "too-complex";

  const { objects, buildItems } = await parseMainModel(mainModelXml, structural, plateAssignmentsByName, partFiles);
  if (objects.size === 0) return "unsupported";

  const plateThumbnails = new Map<number, string>();
  for (const [idx, bytes] of plateThumbBytes) {
    plateThumbnails.set(idx, `data:image/png;base64,${bytes.toString("base64")}`);
  }

  return {
    objects,
    buildItems,
    plateNames: structural.plateNames,
    plateOffsets: structural.plateOffsets,
    plateThumbnails,
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
};

export async function renderModelPreviewGlb(
  srcPath: string,
  destPath: string,
  options: RenderOptions = { simplifyTo: null },
): Promise<"ok" | PreviewRefusal> {
  const parsed = await parseThreeMfFast(srcPath);
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
