// 3D-asset loading (STL/3MF/STEP/OBJ) and theme-based material colouring, shared by ModelViewer
// and the off-tree snapshot generator.
import * as THREE from "three";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import occtWorkerUrl from "occt-import-js/dist/occt-import-js-worker.js?url";
import type { ResolvedTheme } from "../constants/settingsOptions";
import { buildTheme } from "../theme";
import { buildBambuModelGroup, parseBambuThreeMF, type Parsed3MFData, type PlateSummary } from "./bambuThreeMf";
import type { Mesh as SdkMesh } from "../sdk/threeMf";
import { hasOwnColor, keepsOwnColor } from "./ownColor";

export type ModelPalette = {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
};

// paletteForTheme reads theme.ts directly since snapshot generation runs outside React.
function toFloat32(data: ArrayLike<number>): Float32Array {
  return Float32Array.from(data);
}

export function paletteForTheme(theme: ResolvedTheme): ModelPalette {
  const { modelColor, modelEmissive } = buildTheme(theme).thingport;
  return {
    color: new THREE.Color(modelColor),
    emissive: new THREE.Color(modelEmissive),
    emissiveIntensity: theme === "dark" ? 0.08 : 0.05,
    metalness: 0.2,
    roughness: 0.8,
  };
}

export function applyThemeToObject(obj: THREE.Object3D, palette: ModelPalette) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((mat) => {
      if (hasOwnColor(mat)) return;
      const typed = mat as THREE.MeshStandardMaterial;
      if (typed.color) typed.color.copy(palette.color);
      if (typed.emissive) {
        typed.emissive.copy(palette.emissive);
        typed.emissiveIntensity = palette.emissiveIntensity;
      }
      if (typeof typed.metalness === "number") typed.metalness = palette.metalness;
      if (typeof typed.roughness === "number") typed.roughness = palette.roughness;
      mat.needsUpdate = true;
    });
  });
}

/**
 * A mesh already in memory, as something to draw.
 *
 * For geometry the tab made itself -- the customizer's engine hands back the mesh behind the file it wrote --
 * so nothing is written out and parsed again just to look at it.
 *
 * The triangles are given their own corners before the normals are worked out. A solid shares a vertex between
 * the faces meeting at an edge, and averaging across them rounds every hard edge off, which on lettering reads
 * as a smear. It is also what lets each face carry its own colour, since the corners are no longer shared.
 */
export function objectFromMesh(mesh: SdkMesh): THREE.Object3D {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(mesh.vertices), 3));
  indexed.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triangles), 1));
  const geometry = indexed.toNonIndexed();
  indexed.dispose();

  const palette = mesh.palette ?? [];
  const faceColors = mesh.colors;
  const colored = palette.length > 1 && faceColors?.length === mesh.triangles.length / 3;
  if (colored && faceColors) {
    // One colour per corner, the same for all three of a triangle, so each face reads flat rather than
    // blending into its neighbours. Three converts a hex string out of sRGB on its own, so these are
    // already in the working space; converting again would darken every mid-tone.
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    const swatches = palette.map((entry) => new THREE.Color(entry));
    for (let triangle = 0; triangle < faceColors.length; triangle++) {
      const swatch = swatches[faceColors[triangle]] ?? swatches[0];
      for (let corner = 0; corner < 3; corner++) {
        const at = (triangle * 3 + corner) * 3;
        colors[at] = swatch.r;
        colors[at + 1] = swatch.g;
        colors[at + 2] = swatch.b;
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.2,
    roughness: 0.8,
    vertexColors: colored,
  });
  if (colored) keepsOwnColor(material);
  const object = new THREE.Mesh(geometry, material);
  // Generated geometry is Z-up, as print files are; three.js is Y-up.
  object.rotateX(-Math.PI / 2);
  return object;
}

export async function loadObjectFromAsset(ext: string, url: string): Promise<THREE.Object3D | null> {
  const obj = await loadRawObjectFromAsset(ext, url);
  // 3MF is already Y-up from bambuThreeMf.ts.
  if (obj && ext.toLowerCase() !== "3mf") {
    // Print files are Z-up; three.js is Y-up.
    obj.rotateX(-Math.PI / 2);
  }
  return obj;
}

async function loadRawObjectFromAsset(ext: string, url: string): Promise<THREE.Object3D | null> {
  if (ext === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
      new STLLoader().load(url, resolve, undefined, reject);
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.8, color: 0xdddddd }),
    );
    return mesh;
  }
  if (ext === "3mf") {
    return await load3MFObject(url);
  }
  if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    return await new Promise<THREE.Group>((resolve, reject) => {
      new OBJLoader().load(url, resolve, undefined, reject);
    });
  }
  if (ext === "step" || ext === "stp") {
    return await loadStepGroup(url);
  }
  return null;
}

export function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => mat.dispose());
      } else {
        child.material?.dispose();
      }
    }
  });
}

type Simple3MFMesh = {
  positions: Float32Array;
  indices: Uint32Array;
};

type Simple3MFComponent = {
  objectId: string;
  transform?: THREE.Matrix4 | null;
  sourcePath?: string | null;
};

type Simple3MFBuildItem = {
  objectId: string;
  transform?: THREE.Matrix4 | null;
  sourcePath?: string | null;
};

type Simple3MFObject = {
  id: string;
  mesh?: Simple3MFMesh;
  components?: Simple3MFComponent[];
};

type Simple3MFDocument = {
  path: string;
  objects: Map<string, Simple3MFObject>;
  buildItems: Simple3MFBuildItem[];
};

type NamespacedNode = {
  getElementsByTagNameNS: (namespaceURI: string, localName: string) => NodeListOf<Element>;
};

async function loadSimple3MFGroup(url: string): Promise<THREE.Group> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`3MF fetch failed with status ${resp.status}`);
  }
  const raw = new Uint8Array(await resp.arrayBuffer());
  const decoder = new TextDecoder();
  const documents = new Map<string, Simple3MFDocument>();

  const enqueueDocument = (label: string, data: Uint8Array | string) => {
    const xml = typeof data === "string" ? data : decoder.decode(data);
    try {
      const doc = buildSimple3MFDocument(xml, label);
      if (doc.objects.size || doc.buildItems.length) {
        documents.set(doc.path, doc);
      }
    } catch (err) {
      console.warn(`3MF fallback parse failed for ${label}`, err);
    }
  };

  let archiveParsed = false;
  try {
    const { unzipSync } = await import("fflate");
    const zipEntries = unzipSync(raw);
    const modelEntries = Object.keys(zipEntries).filter((key) => /\.model$/i.test(key));
    if (modelEntries.length) {
      archiveParsed = true;
      for (const entry of modelEntries) {
        enqueueDocument(entry, zipEntries[entry]);
      }
    }
  } catch (err) {
    console.warn("3MF fallback unzip failed, attempting inline parse", err);
  }

  if (!archiveParsed) {
    enqueueDocument("/3D/3dmodel.model", raw);
  }

  if (!documents.size) {
    throw new Error("3MF fallback: no printable geometry found");
  }

  const root = buildSceneFromDocuments(documents);
  if (!root.children.length) {
    throw new Error("3MF fallback: no printable geometry found");
  }
  return root;
}

function buildSceneFromDocuments(documents: Map<string, Simple3MFDocument>): THREE.Group {
  const root = new THREE.Group();
  const cache = new Map<string, THREE.Object3D>();

  const instantiateFromDoc = (docPath: string, objectId: string, stack: Set<string>): THREE.Object3D | null => {
    const normalizedPath = normalizeModelPath(docPath);
    const cacheKey = `${normalizedPath}::${objectId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached.clone(true);
    }
    const doc = documents.get(normalizedPath);
    if (!doc) {
      return null;
    }
    if (stack.has(cacheKey)) {
      console.warn("3MF fallback: detected recursive reference for %s", cacheKey);
      return null;
    }
    stack.add(cacheKey);
    const data = doc.objects.get(objectId);
    if (!data) {
      stack.delete(cacheKey);
      return null;
    }

    let created: THREE.Object3D | null = null;
    if (data.mesh) {
      created = meshToThreeObject(data.mesh);
    } else if (data.components?.length) {
      const group = new THREE.Group();
      for (const component of data.components) {
        const child = instantiateFromDoc(component.sourcePath ?? doc.path, component.objectId, stack);
        if (!child) continue;
        if (component.transform) {
          child.applyMatrix4(component.transform.clone());
        }
        group.add(child);
      }
      created = group;
    }
    stack.delete(cacheKey);

    if (!created) return null;
    cache.set(cacheKey, created);
    return created.clone(true);
  };

  for (const doc of documents.values()) {
    if (!doc.buildItems.length) continue;
    const docGroup = new THREE.Group();
    for (const item of doc.buildItems) {
      const built = instantiateFromDoc(item.sourcePath ?? doc.path, item.objectId, new Set<string>());
      if (!built) continue;
      if (item.transform) {
        built.applyMatrix4(item.transform.clone());
      }
      docGroup.add(built);
    }
    if (docGroup.children.length) {
      root.add(docGroup);
    }
  }

  return root;
}

function buildSimple3MFDocument(xml: string, label: string): Simple3MFDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("3MF fallback: invalid XML");
  }

  const path = normalizeModelPath(label);
  const objects = new Map<string, Simple3MFObject>();
  for (const objectNode of findElements(doc, "object")) {
    const id = objectNode.getAttribute("id");
    if (!id) continue;
    const entry: Simple3MFObject = { id };
    const meshNode = findFirstElement(objectNode, "mesh");
    if (meshNode) {
      const mesh = parseSimple3MFMesh(meshNode);
      if (mesh) entry.mesh = mesh;
    }
    const componentsNode = findFirstElement(objectNode, "components");
    if (componentsNode) {
      const components = parseSimple3MFComponents(componentsNode);
      if (components.length) entry.components = components;
    }
    objects.set(id, entry);
  }

  const buildNode = findFirstElement(doc, "build");
  const buildItems = buildNode ? parseSimple3MFBuildItems(buildNode) : [];
  return { path, objects, buildItems };
}

function meshToThreeObject(mesh: Simple3MFMesh): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.2, roughness: 0.8 }));
}

function parseSimple3MFMesh(meshNode: Element): Simple3MFMesh | null {
  const vertexNodes = findElements(meshNode, "vertex");
  const triangleNodes = findElements(meshNode, "triangle");
  if (!vertexNodes.length || !triangleNodes.length) return null;

  const positions = new Float32Array(vertexNodes.length * 3);
  vertexNodes.forEach((vertex, idx) => {
    positions[idx * 3 + 0] = parseFloat(vertex.getAttribute("x") || "0");
    positions[idx * 3 + 1] = parseFloat(vertex.getAttribute("y") || "0");
    positions[idx * 3 + 2] = parseFloat(vertex.getAttribute("z") || "0");
  });

  const indices = new Uint32Array(triangleNodes.length * 3);
  triangleNodes.forEach((tri, idx) => {
    indices[idx * 3 + 0] = parseInt(tri.getAttribute("v1") || "0", 10);
    indices[idx * 3 + 1] = parseInt(tri.getAttribute("v2") || "0", 10);
    indices[idx * 3 + 2] = parseInt(tri.getAttribute("v3") || "0", 10);
  });

  return { positions, indices };
}

function parseSimple3MFComponents(node: Element): Simple3MFComponent[] {
  const components: Simple3MFComponent[] = [];
  for (const componentNode of findElements(node, "component")) {
    const objectId = componentNode.getAttribute("objectid");
    if (!objectId) continue;
    const transformAttr = componentNode.getAttribute("transform");
    const pathAttr = getAttributeByLocalName(componentNode, "path");
    components.push({
      objectId,
      transform: transformAttr ? parse3MFMatrix(transformAttr) : undefined,
      sourcePath: pathAttr ? normalizeModelPath(pathAttr) : undefined,
    });
  }
  return components;
}

function parseSimple3MFBuildItems(node: Element): Simple3MFBuildItem[] {
  const items: Simple3MFBuildItem[] = [];
  for (const itemNode of findElements(node, "item")) {
    const objectId = itemNode.getAttribute("objectid");
    if (!objectId) continue;
    const transformAttr = itemNode.getAttribute("transform");
    const pathAttr = getAttributeByLocalName(itemNode, "path");
    items.push({
      objectId,
      transform: transformAttr ? parse3MFMatrix(transformAttr) : undefined,
      sourcePath: pathAttr ? normalizeModelPath(pathAttr) : undefined,
    });
  }
  return items;
}

function parse3MFMatrix(transform: string): THREE.Matrix4 | null {
  const parts = transform
    .trim()
    .split(/\s+/)
    .map((v) => parseFloat(v))
    .filter((v) => !Number.isNaN(v));
  if (parts.length !== 12) return null;
  const matrix = new THREE.Matrix4();
  matrix.set(
    parts[0],
    parts[3],
    parts[6],
    parts[9],
    parts[1],
    parts[4],
    parts[7],
    parts[10],
    parts[2],
    parts[5],
    parts[8],
    parts[11],
    0,
    0,
    0,
    1,
  );
  return matrix;
}

function getAttributeByLocalName(node: Element, localName: string): string | null {
  const direct = node.getAttribute(localName);
  if (direct !== null) {
    return direct;
  }
  if (typeof node.getAttributeNames === "function") {
    for (const attrName of node.getAttributeNames()) {
      const idx = attrName.indexOf(":");
      if (idx === -1) continue;
      if (attrName.slice(idx + 1) === localName) {
        const value = node.getAttribute(attrName);
        if (value !== null) {
          return value;
        }
      }
    }
  } else {
    for (const prefix of ["p", "m", "s"]) {
      const fallback = node.getAttribute(`${prefix}:${localName}`);
      if (fallback !== null) {
        return fallback;
      }
    }
  }
  return null;
}

function normalizeModelPath(path: string): string {
  const trimmed = (path || "").trim();
  if (!trimmed) return "/3D/3dmodel.model";
  let normalized = trimmed.replace(/\\/g, "/");
  normalized = normalized.replace(/^\/+/, "/");
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  return normalized;
}

function findElements(node: Document | Element, localName: string) {
  const direct = Array.from(node.getElementsByTagName(localName));
  if (direct.length) return direct;
  if ("getElementsByTagNameNS" in node) {
    const nsMatches = (node as unknown as NamespacedNode).getElementsByTagNameNS("*", localName);
    return Array.from(nsMatches ?? []);
  }
  return [];
}

function findFirstElement(node: Document | Element, localName: string) {
  return findElements(node, localName)[0] ?? null;
}

async function loadStepGroup(url: string) {
  type OcctMesh = {
    color?: [number, number, number];
    attributes: {
      position?: { array: ArrayLike<number> };
      normal?: { array: ArrayLike<number> };
    };
    index?: { array: ArrayLike<number> };
  };

  const initOcct = (await import("occt-import-js")).default;
  const resp = await fetch(url);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const occt = await initOcct({
    locateFile: (file: string) => {
      if (file.endsWith(".wasm")) return occtWasmUrl;
      if (file.endsWith(".worker.js")) return occtWorkerUrl;
      return file;
    },
  });
  const res = await occt.ReadStepFile(buf, null);

  const group = new THREE.Group();
  for (const m of res.meshes as OcctMesh[]) {
    const pos = m.attributes?.position?.array;
    if (!pos || !pos.length) continue;

    const geom = new THREE.BufferGeometry();

    geom.setAttribute("position", new THREE.Float32BufferAttribute(toFloat32(pos), 3));

    const normals = m.attributes?.normal?.array;
    if (normals && normals.length) {
      geom.setAttribute("normal", new THREE.Float32BufferAttribute(toFloat32(normals), 3));
    }

    const indices = m.index?.array;
    if (indices && indices.length) {
      geom.setIndex(Array.isArray(indices) ? indices : Array.from(indices as ArrayLike<number>));
    } else {
      geom.computeVertexNormals();
    }
    geom.computeBoundingSphere();

    const color = m.color
      ? new THREE.Color(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255)
      : new THREE.Color(0xf1f5f9);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.8 }));
    group.add(mesh);
  }

  if (!group.children.length) {
    throw new Error("STEP preview produced no meshes");
  }
  return group;
}

async function load3MFObject(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`3MF fetch failed with status ${res.status}`);
    const buffer = await res.arrayBuffer();
    const { parsed, filamentColors } = await parseBambuThreeMF(buffer);
    if (parsed.objects.size > 0) {
      // Every plate together; the interactive viewer uses loadBambuThreeMFForViewer instead.
      const group = buildBambuModelGroup(parsed, null, filamentColors);
      if (group.children.length > 0) return group;
    }
    throw new Error("Bambu 3MF parse produced no meshes");
  } catch (err) {
    console.warn("Bambu 3MF parse failed, falling back to simple 3MF parse", err);
  }
  try {
    return await loadSimple3MFGroup(url);
  } catch (err) {
    console.warn("Simple 3MF parse failed, falling back to ThreeMFLoader", err);
    return await loadViaThreeMFLoader(url);
  }
}

/** Keeps the parsed data so plate switches rebuild locally. Null for anything the Bambu-aware parser
 *  can't handle (the caller falls back to loadObjectFromAsset). */
export async function loadBambuThreeMFForViewer(url: string): Promise<{
  parsedData: Parsed3MFData;
  plates: PlateSummary[];
  filamentColors: string[];
  buildVolume: { x: number; y: number };
  getPlateThumbnail: (plateIndex: number) => Promise<string | null>;
} | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`3MF fetch failed with status ${res.status}`);
  const rawBuffer = await res.arrayBuffer();
  const { parsed, plates, filamentColors, buildVolume, getPlateThumbnail } = await parseBambuThreeMF(rawBuffer);
  if (parsed.objects.size === 0) return null;
  return { parsedData: parsed, plates, filamentColors, buildVolume, getPlateThumbnail };
}

async function loadViaThreeMFLoader(url: string) {
  const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
  return await new Promise<THREE.Group>((resolve, reject) => {
    new ThreeMFLoader().load(url, resolve, undefined, reject);
  });
}
