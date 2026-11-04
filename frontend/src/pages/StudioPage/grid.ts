import * as THREE from "three";
import type { StudioGridSettings } from "../../api/studio";
import type { LengthUnit } from "../../studio/expressions";

// Studio's grid, as CAD draws one: on a plane (the bed, or a sketch's), its spacing following the zoom so the lines
// stay a useful distance apart on screen. Adaptive, it steps by tens (1 mm, 1 cm, 10 cm…) or, in inches, by fours
// (1/16, 1/4, 1 in…): the fine lines fade in as they open up and every tenth (or fourth) is darker, three levels drawn at
// once so nothing jumps as the step changes. Fixed, it's a major spacing and the minor lines between. It fades away
// towards the horizon, and what's snapped to is the finest lines that show.

/** The fewest pixels fine lines are apart before the next step up takes over. */
const MIN_PX: Record<StudioGridSettings["density"], number> = { coarse: 16, normal: 8, fine: 4 };
/** How strong a minor line is beside a major one. */
const MINOR = 0.45;

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export type GridLevels = {
  /** The finest lines' spacing, mm; the next two levels are this times `factor`, and times it again. */
  step: number;
  factor: number;
  /** Each level's strength, 0 to 1: the finest fading in and out with the zoom. */
  alphas: [number, number, number];
  /** What a point snaps to: the finest lines that show. */
  snap: number;
};

/** The grid's spacing at a zoom, `mmPerPx` millimetres to a pixel where the view looks. */
export function gridLevels(settings: StudioGridSettings, units: LengthUnit, mmPerPx: number): GridLevels {
  if (settings.spacing === "fixed") {
    const major = Math.max(settings.major, 1e-3);
    const subdivisions = Math.max(1, Math.round(settings.subdivisions));
    const minor = major / subdivisions;
    // Too fine to draw, they fade rather than shimmer.
    const minorShows = subdivisions > 1 ? smooth(3, 8, minor / mmPerPx) : 0;
    const majorShows = smooth(2, 6, major / mmPerPx);
    return {
      step: minor,
      factor: subdivisions,
      alphas: [MINOR * minorShows, majorShows, majorShows],
      snap: minorShows >= 0.5 ? minor : major,
    };
  }
  const base = units === "in" ? 25.4 : 1;
  const factor = units === "in" ? 4 : 10;
  const least = MIN_PX[settings.density] * mmPerPx;
  // The finest level at least `least` apart, so lines are from MIN_PX to factor times that apart on screen.
  const level = Math.ceil(Math.log(least / base) / Math.log(factor) - 1e-9);
  const step = base * factor ** level;
  // Faint as it closes up to the next step, full well before: at the switch the levels hand over seamlessly.
  const fade = smooth(MIN_PX[settings.density], MIN_PX[settings.density] * 2.5, step / mmPerPx);
  return {
    step,
    factor,
    alphas: [MINOR * fade, MINOR + (1 - MINOR) * fade, 1],
    snap: fade >= 0.5 ? step : step * factor,
  };
}

const vertexShader = `
uniform vec2 uCenter;
uniform float uHalf;
varying vec2 vPlane;
void main() {
  vPlane = uCenter + position.xy * uHalf;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPlane, 0.0, 1.0);
}`;

// Lines a pixel wide whatever the zoom, from how fast the plane's coordinates change across the screen.
const fragmentShader = `
uniform vec2 uCenter;
uniform float uHalf;
uniform float uStep;
uniform float uFactor;
uniform float uOpacity;
uniform vec3 uAlphas;
uniform vec3 uColor;
varying vec2 vPlane;
float lines(float step) {
  vec2 at = vPlane / step;
  vec2 width = max(fwidth(at), vec2(1e-6));
  vec2 near = abs(fract(at - 0.5) - 0.5) / width;
  return 1.0 - min(min(near.x, near.y), 1.0);
}
void main() {
  float alpha = max(
    max(lines(uStep) * uAlphas.x, lines(uStep * uFactor) * uAlphas.y),
    lines(uStep * uFactor * uFactor) * uAlphas.z
  );
  alpha *= uOpacity * (1.0 - smoothstep(0.55, 1.0, length(vPlane - uCenter) / uHalf));
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}`;

/** One grid on a plane: its mesh goes in the scene, and update() sizes it to the view before each frame. */
export class AdaptiveGrid {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** What a point on this plane snaps to now, mm. */
  snap = 1;
  private readonly inverse = new THREE.Matrix4();

  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Behind a face lying on it, as a body's base on the bed.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uHalf: { value: 1 },
        uStep: { value: 1 },
        uFactor: { value: 10 },
        uOpacity: { value: 0.3 },
        uAlphas: { value: new THREE.Vector3(1, 1, 1) },
        uColor: { value: new THREE.Color() },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    // Sized in the shader, so its own bounds mean nothing to culling.
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = -1;
  }

  /** The plane it lies on: its origin and axes in the world. */
  setPlane(origin: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3) {
    this.mesh.matrix.makeBasis(u, v, n).setPosition(origin);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.inverse.copy(this.mesh.matrix).invert();
  }

  setStyle(color: THREE.Color, opacity: number) {
    this.mesh.material.uniforms.uColor.value.copy(color);
    this.mesh.material.uniforms.uOpacity.value = opacity;
  }

  /** Spaced for the view: `heightPx` the view's height, `target` where it looks. */
  update(
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    heightPx: number,
    settings: StudioGridSettings,
    units: LengthUnit,
  ) {
    const distance = Math.max(camera.position.distanceTo(target), 1e-3);
    const mmPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(heightPx, 1);
    const levels = gridLevels(settings, units, mmPerPx);
    const uniforms = this.mesh.material.uniforms;
    const local = target.clone().applyMatrix4(this.inverse);
    uniforms.uCenter.value.set(local.x, local.y);
    // Out to well past the view's edges, faded long before the horizon.
    uniforms.uHalf.value = distance * 3;
    uniforms.uStep.value = levels.step;
    uniforms.uFactor.value = levels.factor;
    uniforms.uAlphas.value.set(...levels.alphas);
    this.snap = levels.snap;
  }
}
