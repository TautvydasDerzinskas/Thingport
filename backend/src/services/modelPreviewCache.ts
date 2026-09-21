import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { MODEL_PREVIEWS, IMPORT_MAX_BYTES } from "../config";
import { readZipEntry, walkZipEntries } from "../utils/zipReader";

// Generates the cached GLB the interactive 3D preview loads instead of re-parsing a raw .3mf
// on every open (see frontend/src/utils/bambuThreeMf.ts, whose *rules* this file mirrors -- same
// extruder-resolution priority, same plate-assignment fallbacks, same component p:path handling
// -- but not its parsing mechanism. That file walks the DOM node-by-node; a Bambu-sliced 3MF for
// a genuinely large model can have millions of <vertex>/<triangle> elements, and DOM attribute
// access at that scale is what causes Thingport's "3D Preview" to hang indefinitely (root-caused
// against a real 224MB/2.66M-triangle repro). This file never builds a DOM for the bulk mesh data
// -- it scans the raw XML text with a handful of fixed-shape regexes straight into typed arrays,
// which is the actual fix. It only runs once per plate (in the background, off the request path)
// rather than on every viewer open.

// ---- FileReader polyfill --------------------------------------------------------------------
//
// Node has no FileReader; three.js's GLTFExporter (examples/jsm/exporters/GLTFExporter.js) needs
// one for its binary (GLB) export path even though nothing here uses images/textures. Confirmed
// working against a real export+reload round-trip (including custom userData surviving through
// glTF `extras`) before this file was written. Node's built-in Blob already provides
// `.arrayBuffer()`, so the polyfill only needs to bridge that to the old onload/onloadend
// callback shape the exporter expects.
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

// ---- Small XML helpers (operate on a tag's raw attribute string, not a DOM node) --------------

function getAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Mirrors bambuThreeMf.ts's parsePlateIdFromAttributes: accepts plate_id/plater_id (any casing,
 * optionally namespace-prefixed) since different Bambu Studio versions have used both spellings. */
function findPlateIdAttr(attrs: string): number | null {
  const m = attrs.match(/(?:^|\s)(?:[\w-]+:)?(?:plate_id|plater_id|plateid|platerid)="([^"]*)"/i);
  if (!m) return null;
  const parsed = Number.parseInt(m[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 3MF's 3x4 affine transform, in the string's own order: [m00 m01 m02 m10 m11 m12 m20 m21 m22
 * tx ty tz]. Applied directly against plain vertex triples below (no THREE.Matrix4 needed) --
 * the mapping is derived from, and produces identical results to, bambuThreeMf.ts's
 * `matrix.set(...)` + `v.applyMatrix4(matrix)`. */
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

// ---- Mesh extraction (the hot path) ------------------------------------------------------------

type FastMesh = { vertices: Float32Array; triangles: Uint32Array; extruder: number };

const MESH_RE = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/g;
const VERTEX_RE = /<vertex\s+x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"/g;
const TRIANGLE_RE = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;

/** Finds every <mesh> block in `xml` and extracts its vertices/triangles directly via regex --
 * no DOM, no per-node attribute lookups. This is the piece that actually fixes the hang: a
 * 2.66M-triangle file that would grind the DOM-based parser to a halt runs through here in a
 * couple of seconds. */
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

// ---- Structural parsing (small documents -- cheerio/JSON are fine here) -----------------------

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

/** Mirrors bambuThreeMf.ts's model_settings.config handling -- small document (a few hundred
 * nodes at most), so a real XML parser (cheerio, already a backend dependency) is fine here. */
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
      if (partExtruderVal) data.partExtruderMap.set(`${objectId}:${partId}`, Math.max(0, parseInt(partExtruderVal, 10) - 1));
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

/** project_settings.config is already JSON (unlike the other Metadata/*.config files) -- direct
 * port of bambuThreeMf.ts's parseProjectSettings, nothing DOM-related to replace here. */
function parseProjectSettingsJson(text: string): { filamentColors: string[]; buildVolume: { x: number; y: number } | null } {
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

// ---- Main model parsing (the hot path, orchestrated) -------------------------------------------

const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*)\/?>/g;
const ITEM_RE = /<item\b([^>]*)\/?>/g;

type InternalComponentRef = { refId: string; transform: number[] | null; extruder: number };

async function parseMainModel(
  xml: string,
  structural: StructuralData,
  plateAssignmentsByName: Map<string, number>,
  loadExternalModel: (path: string) => Promise<string | null>,
): Promise<{ objects: Map<string, ObjectData>; buildItems: BuildItem[] }> {
  const objects = new Map<string, ObjectData>();
  // <component objectid="X" .../> with no p:path references another <object> in this SAME
  // document rather than an external file -- common wrapper pattern (an outer "part" object
  // whose only content is a transformed reference to an inner object that holds the actual
  // mesh). Order in the file isn't guaranteed, so these are resolved in a second pass once
  // every object's own direct meshes are known, not inline during the main loop.
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
      const compExtruder = partKey ? structural.partExtruderMap.get(partKey) ?? defaultExtruder : defaultExtruder;

      if (extPath) {
        const extXml = await loadExternalModel(extPath);
        if (!extXml) continue;
        const extMeshes = extractMeshesFast(extXml, compExtruder);
        for (const mesh of extMeshes) {
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

    // Always keep the entry once an object has *something* (direct meshes or a pending internal
    // reference) -- a pure wrapper object has zero direct meshes at this point but still needs
    // an entry for the resolution pass below to attach the referenced geometry to.
    if (meshes.length > 0 || internalRefsByObjectId.has(objectId)) {
      objects.set(objectId, { id: objectId, meshes, plateId: objectPlateId });
    }
  }

  // Resolve internal component references now that every object's own direct meshes are known.
  // A bounded depth guard (rather than a visited-set) is enough protection against a malformed/
  // cyclic file without needing per-object cycle bookkeeping -- real Bambu wrapper chains are
  // one level deep.
  const MAX_COMPONENT_DEPTH = 8;
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
  for (const objectId of internalRefsByObjectId.keys()) {
    const object = objects.get(objectId);
    if (object) object.meshes.push(...resolveInternalRefs(objectId, 0));
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
      const namePlateId = objectName ? plateAssignmentsByName.get(objectName) ?? null : null;
      buildItems.push({ objectId, transform, plateId: itemPlateId ?? objectPlateId ?? namePlateId ?? null });
    }
  }

  return { objects, buildItems };
}

// ---- Top-level orchestration --------------------------------------------------------------------

type ParsedModel = {
  objects: Map<string, ObjectData>;
  buildItems: BuildItem[];
  plateNames: Map<number, string>;
  plateOffsets: Map<number, { offsetX: number; offsetY: number }>;
  plateThumbnails: Map<number, string>;
  filamentColors: string[];
  buildVolume: { x: number; y: number };
};

const MAIN_MODEL_PATH = "3D/3dmodel.model";
const MAX_TRIANGLES = 8_000_000; // generous safety cap -- see generateModelPreviewGlb

/** Reads and fast-parses a Bambu Studio project .3mf. Returns null for anything not worth
 * caching (no main model, no objects, or over the complexity cap) -- callers fall back to the
 * existing live client-side parser exactly as they do today. */
async function parseThreeMfFast(srcPath: string): Promise<ParsedModel | null> {
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
        if (plateMatch) plateJsonEntries.push({ plateIndex: Number.parseInt(plateMatch[1], 10), text: buf.toString("utf-8") });
        const thumbMatch = entry.name.match(/^Metadata\/(?:plate|top)_(\d+)\.png$/);
        if (thumbMatch) {
          const idx = Number.parseInt(thumbMatch[1], 10);
          // "plate_N" (rendered on the bed) takes priority over "top_N" (plain top-down render);
          // whichever is found first for a given index wins, matching a simple "don't overwrite".
          if (!plateThumbBytes.has(idx)) plateThumbBytes.set(idx, buf);
        }
      }
    },
  );

  if (!mainModelText) return null;
  const mainModelXml: string = mainModelText;

  const structural = modelSettingsText ? parseModelSettingsConfig(modelSettingsText) : parseModelSettingsConfig("");
  const { filamentColors, buildVolume } = projectSettingsText
    ? parseProjectSettingsJson(projectSettingsText)
    : { filamentColors: [], buildVolume: null };

  // plate_*.json fallback for source-only (unsliced-by-MakerWorld) files: bbox_objects names,
  // keyed by object *name* rather than id -- mirrors bambuThreeMf.ts's same fallback.
  const plateAssignmentsByName = new Map<string, number>();
  for (const { plateIndex, text } of plateJsonEntries) {
    try {
      const json = JSON.parse(text) as { bbox_objects?: { name?: string }[] };
      for (const entry of json.bbox_objects ?? []) {
        if (entry?.name) plateAssignmentsByName.set(entry.name, plateIndex);
      }
    } catch {
      // Ignore malformed plate_N.json.
    }
  }

  // Quick complexity check before doing the real work: a single fast pass counting triangle
  // tags, so a pathological file fails immediately instead of after minutes of parsing.
  const triangleCount = (mainModelXml.match(/<triangle\b/g) || []).length;
  if (triangleCount > MAX_TRIANGLES) return null;

  const externalModelCache = new Map<string, string | null>();
  const loadExternalModel = async (rawPath: string): Promise<string | null> => {
    const normalized = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
    if (externalModelCache.has(normalized)) return externalModelCache.get(normalized) ?? null;
    const buf = await readZipEntry(srcPath, normalized, IMPORT_MAX_BYTES);
    const text = buf ? buf.toString("utf-8") : null;
    externalModelCache.set(normalized, text);
    return text;
  };

  const { objects, buildItems } = await parseMainModel(mainModelXml, structural, plateAssignmentsByName, loadExternalModel);
  if (objects.size === 0) return null;

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
  };
}

// ---- GLB construction ----------------------------------------------------------------------

/** Builds the same per-(plate, extruder) merged-mesh grouping bambuThreeMf.ts's
 * buildBambuModelGroup computes on every render, just once, here. The resulting THREE.Group is
 * exported straight to GLB -- the viewer loads the merged meshes directly with no client-side
 * geometry work beyond toggling which plate's sub-group is visible. */
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
  // No real plate assignments at all (e.g. a single-object 3MF with no Bambu plate metadata) --
  // put everything under one synthetic "plate 0" bucket instead of dropping it.
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
        // 3MF Z-up -> three.js Y-up as a rotation, (x, y, z) -> (x, z, -y) -- kept identical to
        // bambuThreeMf.ts's createGeometryFromMesh (see there for why it can't be a plain swap).
        // Changing this changes every cached GLB: bump PREVIEW_FORMAT_VERSION.
        const swapped = new Float32Array(positioned.length);
        for (let i = 0; i < positioned.length; i += 3) {
          swapped[i] = positioned[i];
          swapped[i + 1] = positioned[i + 2];
          swapped[i + 2] = -positioned[i + 1];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(swapped, 3));
        geometry.setIndex(Array.from(mesh.triangles));
        geometry.computeVertexNormals();
        if (!geometriesByExtruder.has(mesh.extruder)) geometriesByExtruder.set(mesh.extruder, []);
        geometriesByExtruder.get(mesh.extruder)!.push(geometry);
      }
    }

    const plateGroup = new THREE.Group();
    plateGroup.name = `plate-${plateIndex}`;
    // Deliberately left visible=true (the default) for every plate here: GLTFExporter's default
    // onlyVisible option drops invisible nodes from the export entirely, which would silently
    // delete every plate but the first. Which plate is *shown* is a client-side concern (see
    // ModelViewer/index.tsx), applied after loading -- not baked into the cached file.
    let objectCount = 0;
    const fallbackColor = new THREE.Color(0xdddddd);
    for (const [extruder, geometries] of geometriesByExtruder) {
      if (geometries.length === 0) continue;
      // Cast: mergeGeometries' bundled .d.ts expects a narrower BufferGeometry generic than the
      // one `await import("three")` infers here -- a type-only mismatch (both are the real
      // three.js BufferGeometry class at runtime), not a real incompatibility.
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

// ---- Cache path helpers (same shape as printService.ts's plateThumbPath/plateThumbExists) -----

// Part of the cache filename, so a change to what buildGlbGroup produces (v2: the Z-up -> Y-up
// conversion became a rotation instead of a mirroring swap) makes every older GLB a cache miss
// and gets it regenerated on next view, rather than serving stale geometry forever.
const PREVIEW_FORMAT_VERSION = 2;

export function modelPreviewGlbPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.v${PREVIEW_FORMAT_VERSION}.glb`);
}

/** Pre-versioning filename (v1) -- removed once its replacement is written. */
function legacyModelPreviewGlbPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.glb`);
}

function modelPreviewErrorPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.error`);
}

export function modelPreviewGlbExists(plateId: string): boolean {
  return fsSync.existsSync(modelPreviewGlbPath(plateId));
}

const ERROR_RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function recentlyFailed(plateId: string): boolean {
  try {
    const stat = fsSync.statSync(modelPreviewErrorPath(plateId));
    return Date.now() - stat.mtimeMs < ERROR_RETRY_COOLDOWN_MS;
  } catch {
    return false;
  }
}

const inFlight = new Set<string>();

/** Generates (or refuses to, gracefully) the cached GLB for one plate. Always resolves --
 * never throws -- so callers can fire-and-forget it without a .catch(). Safe to call
 * concurrently for the same plateId (subsequent calls no-op while one is already running). */
export async function generateModelPreviewGlb(plateId: string, srcPath: string): Promise<void> {
  if (modelPreviewGlbExists(plateId) || inFlight.has(plateId) || recentlyFailed(plateId)) return;
  inFlight.add(plateId);
  try {
    const parsed = await parseThreeMfFast(srcPath);
    if (!parsed) {
      await fs.writeFile(modelPreviewErrorPath(plateId), "unparseable-or-too-complex");
      return;
    }
    const group = await buildGlbGroup(parsed);
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const result = await new GLTFExporter().parseAsync(group, { binary: true });
    const buf = Buffer.from(result as ArrayBuffer);
    const dest = modelPreviewGlbPath(plateId);
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, dest);
    await fs.rm(modelPreviewErrorPath(plateId), { force: true });
    await fs.rm(legacyModelPreviewGlbPath(plateId), { force: true });
  } catch (err) {
    console.error(`Model preview generation failed for plate ${plateId}:`, err);
    await fs.writeFile(modelPreviewErrorPath(plateId), String(err)).catch(() => undefined);
  } finally {
    inFlight.delete(plateId);
  }
}
