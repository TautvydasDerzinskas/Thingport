import fs from "node:fs/promises";
import { analyzeMesh, summarizeQuality, type MeshStats, type QualityReport } from "./meshQuality";
import { loadThreeMfMeshes, type PreviewRefusal } from "./modelPreviewRender";
import { loadStepMeshes } from "./stepLoader";
import { loadGlbScene } from "./gltfScene";

// Loads a model file and runs the printability check on each mesh in it.
//
// Runs in a worker thread (modelPreviewWorker.ts); keep it free of config/db imports.

export async function checkModelQuality(srcPath: string, ext: string): Promise<QualityReport | PreviewRefusal> {
  let meshes: MeshStats[];
  let missingParts = 0;
  try {
    if (ext === ".3mf") {
      const loaded = await loadThreeMfMeshes(srcPath);
      if (typeof loaded === "string") return loaded;
      meshes = loaded.meshes.map((mesh) => analyzeMesh(mesh.vertices, mesh.triangles));
      missingParts = loaded.missingParts;
    } else if (ext === ".stl") {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const buffer = await fs.readFile(srcPath);
      const geometry = new STLLoader().parse(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      );
      meshes = [analyzeMesh(geometry.getAttribute("position").array)];
    } else if (ext === ".obj") {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      const root = new OBJLoader().parse(await fs.readFile(srcPath, "utf8"));
      meshes = [];
      root.traverse((node) => {
        const mesh = node as import("three").Mesh;
        const position = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
        if (position) meshes.push(analyzeMesh(position.array, mesh.geometry.getIndex()?.array));
      });
    } else if (ext === ".glb") {
      const scene = await loadGlbScene(srcPath);
      if (typeof scene === "string") return scene;
      const { Vector3 } = await import("three");
      const vertex = new Vector3();
      meshes = [];
      // Each mesh where the scene puts it: glTF nodes carry the placement and scale, the metres-to-mm included.
      scene.traverse((node) => {
        const mesh = node as import("three").Mesh;
        const position = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
        if (!position) return;
        const placed = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
          vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          placed[i * 3] = vertex.x;
          placed[i * 3 + 1] = vertex.y;
          placed[i * 3 + 2] = vertex.z;
        }
        meshes.push(analyzeMesh(placed, mesh.geometry.getIndex()?.array));
      });
    } else if (ext === ".step" || ext === ".stp") {
      const parts = await loadStepMeshes(srcPath);
      if (parts.length === 0) return "unsupported";
      meshes = parts.map((part) => analyzeMesh(part.positions, part.indices));
    } else {
      return "unsupported";
    }
  } catch {
    // The loaders throw on truncated or garbled files: that's the verdict, not a failure to check.
    return { ...summarizeQuality([]), issues: [{ code: "unreadable" }] };
  }
  return summarizeQuality(meshes, missingParts);
}
