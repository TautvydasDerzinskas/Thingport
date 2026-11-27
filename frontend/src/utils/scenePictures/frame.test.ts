import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { outlinePoints, placeCamera } from "./frame";
import { ANGLES } from "./scenes";

/** A box model as `loadSceneModel` gives it: standing on y = 0, centred, `x` × `y` × `z` mm. */
function box(x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z));
  mesh.position.y = y / 2;
  mesh.updateMatrixWorld();
  return { radius: Math.hypot(x, y, z) / 2, height: y, outline: outlinePoints(mesh) };
}

/** Each angle whose picture of `model` at 4:3 leaves part of it outside the frame. */
function cutOff(model: ReturnType<typeof box>): string[] {
  return ANGLES.filter((angle) => {
    const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100_000);
    placeCamera(camera, model, angle);
    return model.outline.some((point) => {
      const p = point.clone().project(camera);
      return Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
    });
  }).map((angle) => angle.id);
}

describe("framing a model", () => {
  it("keeps all of a tall, a long, a flat and a cubic model in the picture from every angle", () => {
    for (const shape of [box(10, 100, 10), box(200, 6, 8), box(60, 2, 60), box(40, 40, 40), box(12, 300, 40)]) {
      expect(cutOff(shape)).toEqual([]);
    }
  });

  it("stays as close as the angle says when the model already fits", () => {
    // A 40 × 25 mm keyring, 5 mm thick: what the angles were tuned on.
    const keyring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 5, 48).scale(20, 1, 12.5));
    keyring.position.y = 2.5;
    keyring.updateMatrixWorld();
    const model = { radius: Math.hypot(40, 5, 25) / 2, height: 5, outline: outlinePoints(keyring) };
    for (const angle of ANGLES) {
      const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100_000);
      placeCamera(camera, model, angle);
      expect(camera.position.length()).toBeCloseTo(model.radius * angle.distance, 6);
    }
  });

  it("thins a big mesh's points but keeps them spread over all of it", () => {
    const big = new THREE.Mesh(new THREE.SphereGeometry(10, 400, 200));
    big.updateMatrixWorld();
    const points = outlinePoints(big);
    expect(points.length).toBeLessThanOrEqual(20_000);
    expect(new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).x).toBeGreaterThan(19);
  });
});
