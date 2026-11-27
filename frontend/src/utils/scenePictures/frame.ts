import * as THREE from "three";
import type { SceneModel } from "./render";
import type { AngleDef } from "./scenes";

/** The share of the frame, from its centre to an edge, the model may reach. */
const FILL = 0.95;
/** Points enough to find a model's edges; a big mesh is thinned to about this many. */
const OUTLINE_POINTS = 20_000;

/** Points spread over the meshes under `root`, in world space, to frame them by. */
export function outlinePoints(root: THREE.Object3D): THREE.Vector3[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
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
  model: Pick<SceneModel, "radius" | "height" | "outline">,
  angle: AngleDef,
): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(angle.azimuth);
  const el = THREE.MathUtils.degToRad(angle.elevation);
  const direction = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const target = new THREE.Vector3(0, model.height / 2, 0);
  const point = new THREE.Vector3();
  let distance = model.radius * angle.distance;
  for (let step = 0; step < 80; step++, distance *= 1.05) {
    camera.position.copy(direction).multiplyScalar(distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const inFrame = model.outline.every((each) => {
      point.copy(each).project(camera);
      return Math.abs(point.x) <= FILL && Math.abs(point.y) <= FILL;
    });
    if (inFrame) break;
  }
  return target;
}
