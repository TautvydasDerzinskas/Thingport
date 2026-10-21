import fs from "node:fs/promises";
import sharp from "sharp";
import { loadThreeMfGroup, simplifyGroupMeshes, type PreviewRefusal } from "./modelPreviewRender";

// A small picture of a model: one colour, simple light, transparent background. A software
// rasterizer rather than WebGL, so it runs anywhere Node does, with no GPU or native deps.
//
// Runs in a worker thread (modelPreviewWorker.ts); keep it free of config/db imports.

// Past this the picture wouldn't look different, and the render would only take longer: a model over it is simplified
// to SIMPLIFY_TO first, as 3D previews are.
const MAX_TRIANGLES = 4_000_000;
const SIMPLIFY_TO = 1_000_000;
// Drawn this many times larger in each direction, then averaged down for smooth edges.
const SUPERSAMPLE = 3;
// Margin around the model, as a fraction of the image.
const FILL = 0.9;
// A model lower than this fraction of its width is seen from above as well, not edge-on.
const FLAT_RATIO = 0.35;
// The live viewer's opening angle: from the front right and above. A flat model, like a bookmark or a sign, is seen
// from steeply above instead, or it's a sliver and its relief is lost.
const THREE_QUARTER_VIEW: [number, number, number] = [0.9, 0.7, 2.1];
const FLAT_THREE_QUARTER_VIEW: [number, number, number] = [0.45, 1.8, 1];

export type ModelImageOptions = {
  size: number;
  color: string;
  /** "front" is straight on (from above too for a flat model); "threeQuarter" is the live viewer's angle. */
  view?: "front" | "threeQuarter";
  /** Light every face gets, however it's turned. */
  ambient?: number;
  /** Light from the camera, so faces turned away from the main light keep some shape. */
  fill?: number;
};

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec): Vec => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Every triangle as 9 floats, in a Y-up world. */
async function loadTriangles(srcPath: string, ext: string): Promise<Float32Array | PreviewRefusal> {
  const THREE = await import("three");
  let root: import("three").Object3D;
  if (ext === ".3mf") {
    const group = await loadThreeMfGroup(srcPath);
    if (typeof group === "string") return group;
    // Only the first plate: a multi-plate project laid side by side would draw each part tiny.
    root = group.children.find((plate) => plate.children.length > 0) ?? group;
  } else if (ext === ".stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const buffer = await fs.readFile(srcPath);
    const geometry = new STLLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    root = new THREE.Mesh(geometry);
    // Print files are Z-up.
    root.rotateX(-Math.PI / 2);
  } else if (ext === ".obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    root = new OBJLoader().parse(await fs.readFile(srcPath, "utf8"));
    root.rotateX(-Math.PI / 2);
  } else {
    return "unsupported";
  }
  // A group around the model, so a lone STL mesh can be simplified the way a 3MF's plates are.
  const holder = new THREE.Group();
  holder.add(root);

  const countTriangles = () => {
    const meshes: import("three").Mesh[] = [];
    let total = 0;
    holder.traverse((node) => {
      const mesh = node as import("three").Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) return;
      meshes.push(mesh);
      const index = mesh.geometry.getIndex();
      total += (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
    });
    return { meshes, total };
  };
  let { meshes, total: count } = countTriangles();
  if (count > MAX_TRIANGLES) {
    // STL and OBJ load as loose triangles; the simplifier needs them joined at shared corners. Their per-face normals
    // would keep corners apart, and shading here comes from the triangles anyway.
    const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
    for (const mesh of meshes) {
      if (mesh.geometry.getIndex()) continue;
      const loose = mesh.geometry;
      for (const name of Object.keys(loose.attributes)) if (name !== "position") loose.deleteAttribute(name);
      mesh.geometry = mergeVertices(loose);
      loose.dispose();
    }
    await simplifyGroupMeshes(holder, SIMPLIFY_TO);
    ({ meshes, total: count } = countTriangles());
    if (count > MAX_TRIANGLES) return "too-complex";
  }
  holder.updateMatrixWorld(true);

  const out = new Float32Array(Math.floor(count) * 9);
  const vertex = new THREE.Vector3();
  let offset = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const total = index ? index.count : position.count;
    for (let i = 0; i + 2 < total; i += 3) {
      for (let corner = 0; corner < 3; corner++) {
        vertex
          .fromBufferAttribute(position, index ? index.getX(i + corner) : i + corner)
          .applyMatrix4(mesh.matrixWorld);
        out[offset++] = vertex.x;
        out[offset++] = vertex.y;
        out[offset++] = vertex.z;
      }
    }
  }
  return out.subarray(0, offset);
}

function parseHex(color: string): Vec {
  const value = Number.parseInt(color.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Draws the model to a square PNG at `destPath`. */
export async function renderModelImage(
  srcPath: string,
  destPath: string,
  ext: string,
  { size, color, view = "front", ambient = 0.3, fill = 0 }: ModelImageOptions,
): Promise<"ok" | PreviewRefusal> {
  const triangles = await loadTriangles(srcPath, ext);
  if (typeof triangles === "string") return triangles;
  if (triangles.length === 0) return "unsupported";

  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], triangles[i + axis]);
      max[axis] = Math.max(max[axis], triangles[i + axis]);
    }
  }
  const center: Vec = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const flat = max[1] - min[1] < FLAT_RATIO * Math.max(max[0] - min[0], max[2] - min[2]);
  // Towards the camera: straight from the front, or front and above for a flat model.
  const toCamera = normalize(
    view === "threeQuarter" ? (flat ? FLAT_THREE_QUARTER_VIEW : THREE_QUARTER_VIEW) : flat ? [0, 1, 1] : [0, 0, 1],
  );
  const right = normalize(cross([0, 1, 0], toCamera));
  const up = cross(toCamera, right);
  // From above and to the left of the camera, so faces turned towards it still differ in shade.
  const light = normalize([
    toCamera[0] * 0.55 + up[0] - right[0] * 0.75,
    toCamera[1] * 0.55 + up[1] - right[1] * 0.75,
    toCamera[2] * 0.55 + up[2] - right[2] * 0.75,
  ]);

  // Project once: screen x, screen y, depth (larger is nearer).
  const projected = new Float32Array(triangles.length);
  let extent = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const offset = sub([triangles[i], triangles[i + 1], triangles[i + 2]], center);
    const x = dot(offset, right);
    const y = dot(offset, up);
    projected[i] = x;
    projected[i + 1] = y;
    projected[i + 2] = dot(offset, toCamera);
    extent = Math.max(extent, Math.abs(x), Math.abs(y));
  }

  const width = size * SUPERSAMPLE;
  const scale = ((width / 2) * FILL) / (extent || 1);
  const depth = new Float32Array(width * width).fill(-Infinity);
  const shade = new Float32Array(width * width);
  for (let t = 0; t < triangles.length; t += 9) {
    const a: Vec = [triangles[t], triangles[t + 1], triangles[t + 2]];
    let normal = normalize(
      cross(
        sub([triangles[t + 3], triangles[t + 4], triangles[t + 5]], a),
        sub([triangles[t + 6], triangles[t + 7], triangles[t + 8]], a),
      ),
    );
    // Lit from the side facing the camera, whatever the file's winding says.
    if (dot(normal, toCamera) < 0) normal = [-normal[0], -normal[1], -normal[2]];
    const brightness = ambient + (1 - ambient - fill) * Math.max(0, dot(normal, light)) + fill * dot(normal, toCamera);

    const x0 = width / 2 + projected[t] * scale,
      y0 = width / 2 - projected[t + 1] * scale,
      z0 = projected[t + 2];
    const x1 = width / 2 + projected[t + 3] * scale,
      y1 = width / 2 - projected[t + 4] * scale,
      z1 = projected[t + 5];
    const x2 = width / 2 + projected[t + 6] * scale,
      y2 = width / 2 - projected[t + 7] * scale,
      z2 = projected[t + 8];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(width - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5;
        const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area;
        const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const at = py * width + px;
        if (z <= depth[at]) continue;
        depth[at] = z;
        shade[at] = brightness;
      }
    }
  }

  // Averages each block of samples: covered ones give colour and opacity, empty ones only transparency.
  const [r, g, b] = parseHex(color);
  const pixels = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      let lit = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const at = (y * SUPERSAMPLE + sy) * width + x * SUPERSAMPLE + sx;
          if (depth[at] === -Infinity) continue;
          covered++;
          lit += shade[at];
        }
      }
      if (!covered) continue;
      const brightness = lit / covered;
      const out = (y * size + x) * 4;
      pixels[out] = Math.min(255, Math.round(r * brightness));
      pixels[out + 1] = Math.min(255, Math.round(g * brightness));
      pixels[out + 2] = Math.min(255, Math.round(b * brightness));
      pixels[out + 3] = Math.round((covered / samples) * 255);
    }
  }
  await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(destPath);
  return "ok";
}
