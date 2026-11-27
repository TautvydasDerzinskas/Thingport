import * as THREE from "three";
import type { SceneModel } from "./render";
import type { AngleDef } from "./scenes";

/** The share of the frame, from its centre to an edge, the model may reach. */
const FILL = 0.95;
/** Points enough to find a model's edges; a big mesh is thinned to about this many. */
const OUTLINE_POINTS = 20_000;

function meshesUnder(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  return meshes;
}

/** Whether `test` holds for every vertex of the meshes under `root`, in world space. */
function everyVertex(root: THREE.Object3D, test: (vertex: THREE.Vector3) => boolean): boolean {
  const vertex = new THREE.Vector3();
  return meshesUnder(root).every((mesh) => {
    const position = mesh.geometry.attributes.position;
    if (!position) return true;
    for (let i = 0; i < position.count; i++)
      if (!test(vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))) return false;
    return true;
  });
}

/** Points spread over the meshes under `root`, in world space, to frame them by. */
export function outlinePoints(root: THREE.Object3D): THREE.Vector3[] {
  const meshes = meshesUnder(root);
  const total = meshes.reduce((sum, mesh) => sum + (mesh.geometry.attributes.position?.count ?? 0), 0);
  const stride = Math.max(1, Math.ceil(total / OUTLINE_POINTS));
  const points: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position;
    if (!position) continue;
    for (let i = 0; i < position.count; i += stride)
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  }
  return points;
}

/** Puts `camera` on its orbit round the model's foot for `angle`, looking at the model's middle: at the angle's
 *  distance for a model that size, or further back when that would cut part of it off (a tall vase, a long sword).
 *  The camera's aspect must already be the picture's. Returns the point it looks at. */
export function placeCamera(
  camera: THREE.PerspectiveCamera,
  model: Pick<SceneModel, "root" | "radius" | "height" | "outline">,
  angle: AngleDef,
): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(angle.azimuth);
  const el = THREE.MathUtils.degToRad(angle.elevation);
  const direction = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const target = new THREE.Vector3(0, model.height / 2, 0);
  const place = (distance: number) => {
    camera.position.copy(direction).multiplyScalar(distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  const point = new THREE.Vector3();
  const inFrame = (each: THREE.Vector3) => {
    point.copy(each).project(camera);
    return Math.abs(point.x) <= FILL && Math.abs(point.y) <= FILL;
  };
  let distance = model.radius * angle.distance;
  place(distance);
  // The thinned points find the distance quickly; every vertex is then checked there, as thinning can miss a spike's tip.
  for (let step = 0; step < 80 && !model.outline.every(inFrame); step++) place((distance *= 1.05));
  for (let step = 0; step < 80 && !everyVertex(model.root, inFrame); step++) place((distance *= 1.05));
  return target;
}
