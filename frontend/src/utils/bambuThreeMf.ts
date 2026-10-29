// Bambu Studio project .3mf parser. Its "plates" are Bambu Studio build plates, not Thingport Plate
// rows: an uploaded 3MF stays one Plate. The output is already rotated Z-up -> Y-up, so callers
// must not rotate it again.
// Adapted (with modifications) from github.com/maziggy/bambuddy, AGPL-3.0-only.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { keepsOwnColor } from "./ownColor";

type MeshData = {
  vertices: number[];
  triangles: number[];
  extruder: number;
};

type ObjectData = {
  id: string;
  meshes: MeshData[];
  defaultExtruder: number;
  plateId: number | null;
};

type BuildItem = {
  objectId: string;
  transform: THREE.Matrix4;
  plateId: number | null;
};

export type Parsed3MFData = {
  objects: Map<string, ObjectData>;
  buildItems: BuildItem[];
  plateBounds: Map<number, { minX: number; minY: number; maxX: number; maxY: number }>;
  plateOffsets: Map<number, { offsetX: number; offsetY: number }>;
};

export type PlateSummary = {
  index: number;
  name: string | null;
  objectCount: number;
};

export type ParsedBambuThreeMF = {
  parsed: Parsed3MFData;
  plates: PlateSummary[];
  filamentColors: string[];
  buildVolume: { x: number; y: number };
  /** Reads from the already-unzipped archive. */
  getPlateThumbnail: (plateIndex: number) => Promise<string | null>;
};

/**
 * Which filament a painted triangle belongs to, from Bambu Studio's `paint_color`.
 *
 * The attribute is a bitstream in hex, as PrusaSlicer's triangle selector writes it: two bits saying into how
 * many pieces the triangle was split, then two bits of state, and where that state reads 3 it is an escape and
 * the next four bits hold the rest of it. State 0 means unpainted -- the object's own filament -- and state N
 * means the Nth, so the filament list is indexed by N - 1.
 *
 * A split triangle is one painted part of the way across, and its pieces can belong to different filaments.
 * Only the first is read here, so such a triangle takes one of its two colours whole. They lie along the
 * boundary between painted regions, so the seam moves by a triangle; splitting the geometry to follow it
 * exactly would cost more than it shows.
 */
function paintedExtruder(code: string | null): number | null {
  if (!code) return null;
  // Only the last two nibbles are read -- two bits of split count, two of state and four of escape is eight
  // bits, and they sit at the low end. A deeply split triangle's stream is far longer than a number can hold
  // exactly, and taking all of it would shift rubbish into those bits and name the wrong filament.
  const bits = Number.parseInt(code.slice(-2), 16);
  if (!Number.isFinite(bits)) return null;
  let state = (bits >> 2) & 0b11;
  if (state === 0b11) state = 3 + ((bits >> 4) & 0b1111);
  return state > 0 ? state - 1 : null;
}

/** One mesh per filament, keeping only the vertices each one actually uses. */
function byExtruder(vertices: number[], triangles: number[], painted: number[]): MeshData[] {
  const parts = new Map<number, { triangles: number[]; remap: Map<number, number>; vertices: number[] }>();
  for (let face = 0; face < painted.length; face++) {
    const extruder = painted[face];
    let part = parts.get(extruder);
    if (!part) {
      part = { triangles: [], remap: new Map(), vertices: [] };
      parts.set(extruder, part);
    }
    for (let corner = 0; corner < 3; corner++) {
      const original = triangles[face * 3 + corner];
      let moved = part.remap.get(original);
      if (moved === undefined) {
        moved = part.vertices.length / 3;
        part.remap.set(original, moved);
        part.vertices.push(vertices[original * 3], vertices[original * 3 + 1], vertices[original * 3 + 2]);
      }
      part.triangles.push(moved);
    }
  }
  return [...parts].map(([extruder, part]) => ({ vertices: part.vertices, triangles: part.triangles, extruder }));
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function createThumbnailGetter(zipEntries: Record<string, Uint8Array>): (plateIndex: number) => Promise<string | null> {
  return async (plateIndex) => {
    for (const path of [`Metadata/plate_${plateIndex}.png`, `Metadata/top_${plateIndex}.png`]) {
      const bytes = zipEntries[path];
      if (bytes) return bytesToDataUrl(bytes, "image/png");
    }
    return null;
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const YIELD_EVERY_N_VERTICES = 20000;
const YIELD_EVERY_N_TRIANGLES = 20000;

function parseTransform3MF(transformStr: string | null): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  if (!transformStr) return matrix;
  // 3x4 affine matrix, row-major; (m30, m31, m32) is the translation.
  const values = transformStr.trim().split(/\s+/).map(parseFloat);
  if (values.length >= 12) {
    matrix.set(
      values[0],
      values[1],
      values[2],
      values[9],
      values[3],
      values[4],
      values[5],
      values[10],
      values[6],
      values[7],
      values[8],
      values[11],
      0,
      0,
      0,
      1,
    );
  }
  return matrix;
}

type ElementSource = { getElementsByTagName(tag: string): HTMLCollectionOf<Element> };

/** A `displaycolor` as the 3MF spec writes it -- `#RRGGBB` or `#RRGGBBAA` -- as a CSS colour, alpha dropped:
 *  how see-through a material is says nothing about what colour it was printed in. */
function displayColor(value: string | null): string | null {
  const hex = value?.trim().replace(/^#/, "") ?? "";
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

/** The colours of a 3MF's own material groups, flattened, and which of them a `pid` and index name. */
export type BaseMaterials = {
  colors: string[];
  /** The slot a group's `index`th entry landed in, or null for a group or index the file hasn't got. */
  slotOf: (pid: string | null, index: number) => number | null;
};

/**
 * The colours a 3MF carries in its own right: a property group in `<resources>`, pointed into by `pid` and `p1`.
 * That is the spec's own way to colour a mesh, and what the customizer writes (sdk/threeMf.ts); Bambu's
 * `paint_color` is a separate thing layered over a sliced project's filaments.
 *
 * Two groups say it: the core spec's `<basematerials>` of `<base displaycolor>`, and the Materials extension's
 * `<m:colorgroup>` of `<m:color color>`, which is the one slicers read and so the one Thingport writes. Both
 * are taken, since a 3MF from anywhere may use either.
 *
 * All of these say the same thing -- a colour per index, an index per triangle -- so the entries are flattened
 * into one list the painted path's indexes can share, and everything downstream colours them alike. Null for a
 * file with no materials, so a caller can tell that from a group holding nothing readable.
 */
export function readBaseMaterials(doc: ElementSource): BaseMaterials | null {
  const colors: string[] = [];
  const slots = new Map<string, number>();
  const readGroups = (groupTag: string, entryTag: string, attr: string): boolean => {
    const before = colors.length;
    const groups = doc.getElementsByTagName(groupTag);
    for (let i = 0; i < groups.length; i++) {
      const groupId = groups[i].getAttribute("id");
      if (!groupId) continue;
      const entries = groups[i].getElementsByTagName(entryTag);
      for (let j = 0; j < entries.length; j++) {
        const color = displayColor(entries[j].getAttribute(attr));
        // Keyed by where it actually sits, so an entry with no readable colour doesn't shift the ones after it.
        if (!color) continue;
        slots.set(`${groupId}:${j}`, colors.length);
        colors.push(color);
      }
    }
    return colors.length > before;
  };
  readGroups("basematerials", "base", "displaycolor");
  // The extension's elements are namespaced, and the prefix is part of the tag name an XML DOM matches on.
  // Bambu Studio only ever writes and reads `m:`, so that is what files carry; the bare name is tried only
  // when that found nothing, for a writer that made the material namespace the document's default.
  if (!readGroups("m:colorgroup", "m:color", "color")) readGroups("colorgroup", "color", "color");
  if (!colors.length) return null;
  return { colors, slotOf: (pid, index) => (pid === null ? null : (slots.get(`${pid}:${index}`) ?? null)) };
}

/** Which colour a triangle's `p1` names, in the group the triangle itself points at or else its object's. */
export function readTriangleMaterial(
  materials: BaseMaterials,
  objectPid: string | null,
): (triangle: Element) => number | null {
  return (triangle) =>
    materials.slotOf(triangle.getAttribute("pid") ?? objectPid, Number.parseInt(triangle.getAttribute("p1") ?? "", 10));
}

/** `materialSlot` reads a triangle's colour from the file's own materials, for a 3MF coloured the spec's way. */
async function parseMeshFromDoc(
  doc: ElementSource,
  defaultExtruder = 0,
  materialSlot?: (triangle: Element) => number | null,
): Promise<MeshData[]> {
  const meshes: MeshData[] = [];
  const meshElements = doc.getElementsByTagName("mesh");
  for (let j = 0; j < meshElements.length; j++) {
    const meshEl = meshElements[j];
    const vertices: number[] = [];
    const triangles: number[] = [];

    const vertexElements = meshEl.getElementsByTagName("vertex");
    for (let k = 0; k < vertexElements.length; k++) {
      const v = vertexElements[k];
      vertices.push(
        parseFloat(v.getAttribute("x") || "0"),
        parseFloat(v.getAttribute("y") || "0"),
        parseFloat(v.getAttribute("z") || "0"),
      );
      if (k > 0 && k % YIELD_EVERY_N_VERTICES === 0) await nextTick();
    }

    // A painted model says which filament each triangle belongs to; null until one actually does.
    let painted: number[] | null = null;
    const triangleElements = meshEl.getElementsByTagName("triangle");
    for (let k = 0; k < triangleElements.length; k++) {
      const t = triangleElements[k];
      triangles.push(
        parseInt(t.getAttribute("v1") || "0", 10),
        parseInt(t.getAttribute("v2") || "0", 10),
        parseInt(t.getAttribute("v3") || "0", 10),
      );
      // paint_color first: where a slicer painted a model, that is the later word on its colours.
      const paint = paintedExtruder(t.getAttribute("paint_color")) ?? materialSlot?.(t) ?? null;
      if (paint !== null) {
        painted ??= Array.from<number>({ length: triangleElements.length }).fill(defaultExtruder);
        painted[k] = paint;
      }
      if (k > 0 && k % YIELD_EVERY_N_TRIANGLES === 0) await nextTick();
    }

    if (vertices.length > 0 && triangles.length > 0) {
      // A painted mesh becomes one mesh per filament, which is how the builder already colours them.
      for (const part of painted
        ? byExtruder(vertices, triangles, painted)
        : [{ vertices, triangles, extruder: defaultExtruder }]) {
        meshes.push(part);
      }
    }
  }
  return meshes;
}

function parsePlateIdFromAttributes(element: Element): number | null {
  const plateAttribute = Array.from(element.attributes).find((attr) => {
    const name = attr.name.toLowerCase();
    return (
      name === "plate_id" ||
      name === "plater_id" ||
      name === "plateid" ||
      name === "platerid" ||
      name.endsWith(":plate_id") ||
      name.endsWith(":plater_id")
    );
  });
  if (!plateAttribute?.value) return null;
  const parsed = Number.parseInt(plateAttribute.value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Best-effort; callers fall back to defaults. */
function parseProjectSettings(text: string): {
  filamentColors: string[];
  buildVolume: { x: number; y: number } | null;
} {
  let filamentColors: string[] = [];
  let buildVolume: { x: number; y: number } | null = null;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    if (Array.isArray(json.filament_colour)) {
      // Bambu Studio usually writes these as #RRGGBBAA, and three.js reads only the six-digit spelling, so
      // the alpha comes off here rather than every filament falling back to white where it's there.
      filamentColors = json.filament_colour
        .map((c) => (typeof c === "string" ? displayColor(c) : null))
        .filter((c): c is string => c !== null);
    }
    const area = json.printable_area;
    if (Array.isArray(area) && area.length >= 3 && typeof area[2] === "string") {
      // "0x0 256x0 256x256 0x256" -- the third corner is the bed's (width, depth).
      const match = area[2].match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
      if (match) buildVolume = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
    }
  } catch {}
  return { filamentColors, buildVolume };
}

async function parse3MF(zipEntries: Record<string, Uint8Array>): Promise<ParsedBambuThreeMF> {
  const getPlateThumbnail = createThumbnailGetter(zipEntries);
  const objects = new Map<string, ObjectData>();
  const buildItems: BuildItem[] = [];
  const plateBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  const plateOffsets = new Map<number, { offsetX: number; offsetY: number }>();
  const plateNames = new Map<number, string>();
  const decoder = new TextDecoder();
  const parser = new DOMParser();

  const findEntry = (path: string): Uint8Array | undefined => {
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return zipEntries[normalized];
  };
  // A multi-part object references the same part file once per part.
  const modelFileCache = new Map<string, Document | null>();
  const loadModelFile = (path: string): Document | null => {
    if (modelFileCache.has(path)) return modelFileCache.get(path) ?? null;
    const bytes = findEntry(path);
    const doc = bytes ? parser.parseFromString(decoder.decode(bytes), "application/xml") : null;
    modelFileCache.set(path, doc);
    return doc;
  };

  const extruderMapById = new Map<string, number>();
  const partExtruderMap = new Map<string, number>();
  const objectNameById = new Map<string, string>();
  const plateAssignmentsByObjectId = new Map<string, number>();

  const modelSettingsBytes = findEntry("Metadata/model_settings.config");
  if (modelSettingsBytes) {
    try {
      const doc = parser.parseFromString(decoder.decode(modelSettingsBytes), "application/xml");
      const objectElements = doc.getElementsByTagName("object");
      for (let i = 0; i < objectElements.length; i++) {
        const objEl = objectElements[i];
        const objectId = objEl.getAttribute("id");
        if (!objectId) continue;

        const directMetadata = Array.from(objEl.children).filter(
          (el) => el.tagName === "metadata" && el.getAttribute("key") === "extruder",
        );
        if (directMetadata.length > 0) {
          const extruderVal = directMetadata[0].getAttribute("value");
          if (extruderVal) extruderMapById.set(objectId, Math.max(0, parseInt(extruderVal, 10) - 1));
        }

        const nameMetadata = Array.from(objEl.children).find(
          (el) => el.tagName === "metadata" && el.getAttribute("key") === "name",
        );
        const objectName = nameMetadata?.getAttribute("value");
        if (objectName) objectNameById.set(objectId, objectName);

        const partElements = objEl.getElementsByTagName("part");
        for (let j = 0; j < partElements.length; j++) {
          const partEl = partElements[j];
          const partId = partEl.getAttribute("id");
          if (!partId) continue;
          const partMetadata = Array.from(partEl.children).filter(
            (el) => el.tagName === "metadata" && el.getAttribute("key") === "extruder",
          );
          if (partMetadata.length > 0) {
            const extruderVal = partMetadata[0].getAttribute("value");
            if (extruderVal) partExtruderMap.set(`${objectId}:${partId}`, Math.max(0, parseInt(extruderVal, 10) - 1));
          }
        }
      }

      const plateElements = doc.getElementsByTagName("plate");
      for (let i = 0; i < plateElements.length; i++) {
        const plateEl = plateElements[i];
        let plateId: number | null = null;
        let plateOffsetX = 0;
        let plateOffsetY = 0;
        const metadataElements = plateEl.getElementsByTagName("metadata");
        for (let j = 0; j < metadataElements.length; j++) {
          const metaEl = metadataElements[j];
          const key = metaEl.getAttribute("key");
          const value = metaEl.getAttribute("value");
          if ((key === "plater_id" || key === "plate_id") && value) {
            const parsedId = Number.parseInt(value, 10);
            if (Number.isFinite(parsedId)) plateId = parsedId;
          } else if (key === "pos_x" && value) {
            const parsedVal = Number.parseFloat(value);
            if (Number.isFinite(parsedVal)) plateOffsetX = parsedVal;
          } else if (key === "pos_y" && value) {
            const parsedVal = Number.parseFloat(value);
            if (Number.isFinite(parsedVal)) plateOffsetY = parsedVal;
          }
        }
        if (plateId == null) continue;
        if (plateOffsetX !== 0 || plateOffsetY !== 0)
          plateOffsets.set(plateId, { offsetX: plateOffsetX, offsetY: plateOffsetY });
        const nameMeta = Array.from(metadataElements).find((m) => m.getAttribute("key") === "plater_name");
        const nameVal = nameMeta?.getAttribute("value")?.trim();
        if (nameVal) plateNames.set(plateId, nameVal);

        const modelInstances = plateEl.getElementsByTagName("model_instance");
        for (let j = 0; j < modelInstances.length; j++) {
          const instanceMetadata = modelInstances[j].getElementsByTagName("metadata");
          for (let k = 0; k < instanceMetadata.length; k++) {
            if (instanceMetadata[k].getAttribute("key") === "object_id") {
              const value = instanceMetadata[k].getAttribute("value");
              if (value) plateAssignmentsByObjectId.set(value, plateId);
            }
          }
        }
      }
    } catch {}
  }

  // Fallback for files MakerWorld didn't slice: plate_N.json keyed by object name.
  const plateAssignmentsByName = new Map<string, number>();
  for (const name of Object.keys(zipEntries)) {
    const match = name.match(/^Metadata\/plate_(\d+)\.json$/);
    if (!match) continue;
    const plateIndex = Number.parseInt(match[1], 10);
    if (!Number.isFinite(plateIndex)) continue;
    try {
      const json = JSON.parse(decoder.decode(zipEntries[name])) as {
        bbox_objects?: { name?: string }[];
        bbox_all?: number[];
      };
      for (const entry of json.bbox_objects ?? []) {
        if (entry?.name) plateAssignmentsByName.set(entry.name, plateIndex);
      }
      if (Array.isArray(json.bbox_all) && json.bbox_all.length >= 4) {
        const [minX, minY, maxX, maxY] = json.bbox_all;
        if ([minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) {
          plateBounds.set(plateIndex, { minX, minY, maxX, maxY });
        }
      }
    } catch {}
  }

  const mainModelPath = Object.keys(zipEntries).find(
    (name) => name === "3D/3dmodel.model" || name.endsWith("/3dmodel.model"),
  );
  let filamentColors: string[] = [];
  let buildVolume: { x: number; y: number } | null = null;
  const projectSettingsBytes = findEntry("Metadata/project_settings.config");
  if (projectSettingsBytes) {
    const result = parseProjectSettings(decoder.decode(projectSettingsBytes));
    filamentColors = result.filamentColors;
    buildVolume = result.buildVolume;
  }

  if (!mainModelPath) {
    const anyModelPath = Object.keys(zipEntries).find((name) => name.endsWith(".model"));
    if (anyModelPath) {
      const doc = loadModelFile(anyModelPath);
      if (doc) {
        const meshes = await parseMeshFromDoc(doc, 0);
        if (meshes.length > 0) objects.set("1", { id: "1", meshes, defaultExtruder: 0, plateId: null });
      }
    }
    return {
      parsed: { objects, buildItems, plateBounds, plateOffsets },
      plates: [],
      filamentColors,
      buildVolume: buildVolume ?? { x: 256, y: 256 },
      getPlateThumbnail,
    };
  }

  const mainDoc = loadModelFile(mainModelPath);
  if (!mainDoc) {
    return {
      parsed: { objects, buildItems, plateBounds, plateOffsets },
      plates: [],
      filamentColors,
      buildVolume: buildVolume ?? { x: 256, y: 256 },
      getPlateThumbnail,
    };
  }

  // Only where the project named no filaments of its own: a slicer's list is the better word on a project it
  // sliced, and a plain 3MF -- the customizer's own output among them -- has nothing but these.
  const baseMaterials = filamentColors.length ? null : readBaseMaterials(mainDoc);
  if (baseMaterials) filamentColors = baseMaterials.colors;

  const objectElements = mainDoc.getElementsByTagName("object");
  for (let i = 0; i < objectElements.length; i++) {
    if (i > 0) await nextTick();
    const objEl = objectElements[i];
    const objectId = objEl.getAttribute("id");
    if (!objectId) continue;

    const objectPlateId = parsePlateIdFromAttributes(objEl) ?? plateAssignmentsByObjectId.get(objectId) ?? null;
    let defaultExtruder = extruderMapById.get(objectId) ?? -1;
    if (defaultExtruder < 0) {
      const extruderAttr =
        objEl.getAttribute("p:extruder") ||
        objEl.getAttributeNS("http://schemas.microsoft.com/3dmanufacturing/production/2015/06", "extruder") ||
        "1";
      defaultExtruder = Math.max(0, parseInt(extruderAttr, 10) - 1);
    }

    // An object pointing at a material is that colour, bar the triangles naming another. Only this document's
    // objects: resource ids are each model file's own, so reading a part file's triangles against these would
    // colour them by whatever happened to share an id.
    const objectSlot = baseMaterials?.slotOf(
      objEl.getAttribute("pid"),
      Number.parseInt(objEl.getAttribute("pindex") ?? "", 10),
    );
    if (objectSlot != null) defaultExtruder = objectSlot;

    const meshes: MeshData[] = await parseMeshFromDoc(
      objEl,
      defaultExtruder,
      baseMaterials ? readTriangleMaterial(baseMaterials, objEl.getAttribute("pid")) : undefined,
    );

    const componentElements = objEl.getElementsByTagName("component");
    for (let j = 0; j < componentElements.length; j++) {
      await nextTick();
      const compEl = componentElements[j];
      const extPath =
        compEl.getAttribute("p:path") ||
        compEl.getAttributeNS("http://schemas.microsoft.com/3dmanufacturing/production/2015/06", "path");
      const compObjectId = compEl.getAttribute("objectid");
      if (!extPath) continue;
      const extDoc = loadModelFile(extPath);
      if (!extDoc) continue;

      const partKey = compObjectId ? `${objectId}:${compObjectId}` : null;
      const compExtruder = partKey ? (partExtruderMap.get(partKey) ?? defaultExtruder) : defaultExtruder;
      // A part file can hold every part of a multi-part object, so take only the one this component
      // names. Mirrors modelPreviewRender.ts's createPartFileResolver.
      const targetEl = compObjectId
        ? Array.from(extDoc.getElementsByTagName("object")).find((el) => el.getAttribute("id") === compObjectId)
        : undefined;
      const targetMeshes = targetEl ? await parseMeshFromDoc(targetEl, compExtruder) : [];
      const extMeshes = targetMeshes.length > 0 ? targetMeshes : await parseMeshFromDoc(extDoc, compExtruder);
      const compTransformStr = compEl.getAttribute("transform");
      const compTransform = parseTransform3MF(compTransformStr);

      for (const mesh of extMeshes) {
        if (compTransformStr) {
          const transformedVertices: number[] = [];
          for (let k = 0; k < mesh.vertices.length; k += 3) {
            const v = new THREE.Vector3(mesh.vertices[k], mesh.vertices[k + 1], mesh.vertices[k + 2]);
            v.applyMatrix4(compTransform);
            transformedVertices.push(v.x, v.y, v.z);
          }
          meshes.push({ vertices: transformedVertices, triangles: mesh.triangles, extruder: mesh.extruder });
        } else {
          meshes.push(mesh);
        }
      }
    }

    if (meshes.length > 0) objects.set(objectId, { id: objectId, meshes, defaultExtruder, plateId: objectPlateId });
  }

  const buildElements = mainDoc.getElementsByTagName("build");
  if (buildElements.length > 0) {
    const itemElements = buildElements[0].getElementsByTagName("item");
    for (let i = 0; i < itemElements.length; i++) {
      const itemEl = itemElements[i];
      const objectId = itemEl.getAttribute("objectid");
      if (!objectId) continue;
      const transform = parseTransform3MF(itemEl.getAttribute("transform"));
      const itemPlateId = parsePlateIdFromAttributes(itemEl);
      const objectPlateId = objects.get(objectId)?.plateId ?? null;
      const objectName = objectNameById.get(objectId);
      const namePlateId = objectName ? (plateAssignmentsByName.get(objectName) ?? null) : null;
      buildItems.push({ objectId, transform, plateId: itemPlateId ?? objectPlateId ?? namePlateId ?? null });
    }
  }

  const objectCountByPlate = new Map<number, number>();
  for (const item of buildItems) {
    if (item.plateId == null) continue;
    objectCountByPlate.set(item.plateId, (objectCountByPlate.get(item.plateId) ?? 0) + 1);
  }
  const plates: PlateSummary[] = Array.from(objectCountByPlate.keys())
    .toSorted((a, b) => a - b)
    .map((index) => ({ index, name: plateNames.get(index) ?? null, objectCount: objectCountByPlate.get(index) ?? 0 }));

  return {
    parsed: { objects, buildItems, plateBounds, plateOffsets },
    plates,
    filamentColors,
    buildVolume: buildVolume ?? { x: 256, y: 256 },
    getPlateThumbnail,
  };
}

/** Also handles generic 3MFs; without model_settings.config there's no plate/extruder info. */
export async function parseBambuThreeMF(buffer: ArrayBuffer): Promise<ParsedBambuThreeMF> {
  const { unzipSync } = await import("fflate");
  const zipEntries = unzipSync(new Uint8Array(buffer));
  return parse3MF(zipEntries);
}

export type CachedBambuGlb = {
  /** One "plate-{index}" group per plate, so switching plates is a visibility toggle. */
  rootGroup: THREE.Group;
  plates: PlateSummary[];
  filamentColors: string[];
  buildVolume: { x: number; y: number };
  getPlateThumbnail: (plateIndex: number) => Promise<string | null>;
};

/** "failed": the browser mustn't try either, since it would exhaust its memory. "fallback": parse
 *  the raw file in the browser. */
export type CachedGlbOutcome =
  { status: "ready"; glb: CachedBambuGlb } | { status: "generating" } | { status: "failed" } | { status: "fallback" };

async function previewErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function loadCachedBambuGlb(url: string): Promise<CachedGlbOutcome> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const code = res.status === 404 ? await previewErrorCode(res) : null;
      if (code === "PREVIEW_GENERATING") return { status: "generating" };
      if (code === "PREVIEW_FAILED") return { status: "failed" };
      return { status: "fallback" };
    }
    const arrayBuffer = await res.arrayBuffer();

    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      new GLTFLoader().parse(arrayBuffer, "", (result) => resolve(result as unknown as { scene: THREE.Group }), reject);
    });

    let root: THREE.Object3D | null = null;
    gltf.scene.traverse((obj) => {
      if (!root && typeof obj.userData?.thingportPreview === "string") root = obj;
    });
    if (!root) return { status: "fallback" };

    const meta = JSON.parse((root as THREE.Object3D).userData.thingportPreview) as {
      plates: PlateSummary[];
      plateThumbnails: Record<string, string>;
      filamentColors: string[];
      buildVolume: { x: number; y: number };
    };
    markOwnColors(root as THREE.Object3D);

    return {
      status: "ready",
      glb: {
        rootGroup: root as THREE.Group,
        plates: meta.plates,
        filamentColors: meta.filamentColors,
        buildVolume: meta.buildVolume,
        getPlateThumbnail: async (plateIndex: number) => meta.plateThumbnails[String(plateIndex)] ?? null,
      },
    };
  } catch (err) {
    console.warn("Cached GLB preview load failed, falling back to live 3MF parse", err);
    return { status: "fallback" };
  }
}

/**
 * Marks the colours a cached GLB brought with it, so the reader's colour leaves them alone.
 *
 * The server writes one mesh per filament or colour group per plate (modelPreviewRender.ts), so a plate
 * showing more than one of them is a model with colours of its own -- a painted project, or a generated model
 * the script coloured. A plate of one colour is a shape in whatever colour it happened to be saved in, and
 * stays recolourable, which is the same rule buildBambuModelGroup follows for a 3MF parsed here.
 */
function markOwnColors(root: THREE.Object3D): void {
  for (const plate of root.children) {
    const materials: THREE.Material[] = [];
    const shown = new Set<string>();
    plate.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.push(material);
        const color = (material as THREE.MeshStandardMaterial).color;
        if (color) shown.add(color.getHexString());
      }
    });
    if (shown.size > 1) materials.forEach(keepsOwnColor);
  }
}

function createGeometryFromMesh(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // 3MF Z-up -> three.js Y-up: (x, y, z) -> (x, z, -y). It must be a rotation: a plain Y/Z swap
  // mirrors the model and reverses triangle winding. Keep identical to modelPreviewRender.ts.
  const positions = new Float32Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    positions[i] = mesh.vertices[i];
    positions[i + 1] = mesh.vertices[i + 2];
    positions[i + 2] = -mesh.vertices[i + 1];
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(mesh.triangles);
  geometry.computeVertexNormals();
  return geometry;
}

/** `selectedPlateId` null renders every plate. Each extruder gets its own merged mesh. */
export function buildBambuModelGroup(
  parsedData: Parsed3MFData,
  selectedPlateId: number | null,
  filamentColors: string[],
): THREE.Group {
  const { objects, buildItems } = parsedData;
  const group = new THREE.Group();

  const getMaterial = (
    extruder: number,
    fallbackColor: THREE.Color,
    multicolour: boolean,
  ): THREE.MeshStandardMaterial => {
    const colorStr = filamentColors[extruder];
    const color = colorStr ? new THREE.Color(colorStr) : fallbackColor;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.0,
      envMapIntensity: 0.55,
    });
    if (colorStr && multicolour) keepsOwnColor(material);
    return material;
  };

  const geometriesByExtruder = new Map<number, THREE.BufferGeometry[]>();
  const hasPlateAssignments = buildItems.some((item) => item.plateId != null);
  const plateFilteredItems =
    selectedPlateId == null || !hasPlateAssignments
      ? buildItems
      : buildItems.filter((item) => item.plateId === selectedPlateId);
  const activeBuildItems = plateFilteredItems.length > 0 ? plateFilteredItems : buildItems;

  for (const item of activeBuildItems) {
    const objectData = objects.get(item.objectId);
    if (!objectData) continue;
    for (const meshData of objectData.meshes) {
      const transformedVertices: number[] = [];
      for (let k = 0; k < meshData.vertices.length; k += 3) {
        const v = new THREE.Vector3(meshData.vertices[k], meshData.vertices[k + 1], meshData.vertices[k + 2]);
        v.applyMatrix4(item.transform);
        transformedVertices.push(v.x, v.y, v.z);
      }
      const geometry = createGeometryFromMesh({
        vertices: transformedVertices,
        triangles: meshData.triangles,
        extruder: meshData.extruder,
      });
      if (!geometriesByExtruder.has(meshData.extruder)) geometriesByExtruder.set(meshData.extruder, []);
      geometriesByExtruder.get(meshData.extruder)!.push(geometry);
    }
  }

  const fallbackColor = new THREE.Color(0xdddddd);
  // Only what is actually on screen counts as the model's own colour. A project may list three filaments
  // while the plate being shown uses one, and that one is a shape in whatever colour the slicer happened to
  // be set to -- the reader should still be able to change it.
  const shown = new Set(
    [...geometriesByExtruder]
      .filter(([, geometries]) => geometries.length > 0)
      .map(([extruder]) => filamentColors[extruder])
      .filter((color): color is string => Boolean(color)),
  );
  const multicolour = shown.size > 1;
  for (const [extruder, geometries] of geometriesByExtruder) {
    if (geometries.length === 0) continue;
    const mergedGeometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (mergedGeometry) {
      const mesh = new THREE.Mesh(mergedGeometry, getMaterial(extruder, fallbackColor, multicolour));
      mesh.castShadow = true;
      group.add(mesh);
    }
    if (geometries.length > 1) geometries.forEach((g) => g.dispose());
  }

  return group;
}
