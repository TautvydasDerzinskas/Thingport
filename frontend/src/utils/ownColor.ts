import type * as THREE from "three";

// Whose colour a model is drawn in.
//
// Most models have no colour of their own: they are a shape, and Thingport draws them in the theme's colour or
// the one the reader picked, so one model looks right in any of them. A model that does carry colour -- a
// script's `color()` calls, a 3MF's painted parts -- means those colours, and showing such a model in one
// colour shows something it isn't. Materials built from a model's own colours are marked here, and every place
// that would otherwise recolour a material leaves a marked one alone.
//
// In a module of its own because both the loaders and the 3MF parser mark materials, and the loaders already
// read the parser.

export function keepsOwnColor(material: THREE.Material): void {
  material.userData.ownColor = true;
}

export const hasOwnColor = (material: THREE.Material): boolean => material.userData.ownColor === true;

/** Whether anything in the object brought its own colours. */
export function objectHasOwnColor(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (found || !material) return;
    if ((Array.isArray(material) ? material : [material]).some(hasOwnColor)) found = true;
  });
  return found;
}
