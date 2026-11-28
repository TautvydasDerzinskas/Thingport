// Where a plate's wipe tower goes. Bambu Studio puts it where the project says (`wipe_tower_x`/`wipe_tower_y`, its
// front-left corner, a value per plate), else at a default spot past the back of most beds, and refuses a plate whose
// tower prints into an object or off the bed. It sizes the tower from the project's settings
// (PartPlate::estimate_wipe_tower_size): a tower that fits as they size it is left where it is, and one placed here is
// sized larger, as MakerWorld's upload check builds a bigger one than the designer's slicer did.

import { processNameParts, type BedBox } from "../../adapter/printer";
import { asArray, firstValue, type Settings } from "../../adapter/settings";
import { clearance, type Footprint } from "./footprint";
import type { Box2 } from "./layout";

/** A plate as its tower sees it: what's on the bed, in the plate's coordinates (mm), and what the tower is sized by. */
export type TowerPlate = { footprint: Footprint; filaments: number; height: number };

/** What the slicer sizes a tower by, as the project sets it or by the slicer's defaults (PrintConfig.cpp). */
export type TowerSettings = {
  /** The most a filament primes per change, in mm³. */
  primeVolume: number;
  layerHeight: number;
  infillGap: number;
  ribWall: boolean;
  ribWidth: number;
  extraRibLength: number;
  /** A tower's width without rib walls. */
  width: number;
  brim: number;
  /** Nozzles the printer has: with two, each filament on the plate takes a share. */
  nozzles: number;
};

// Its least depth by the tower's height (WipeTower::min_depth_per_height).
const MIN_DEPTH_BY_HEIGHT: [number, number][] = [
  [5, 5],
  [100, 20],
  [250, 40],
  [350, 60],
];
// A tower placed here: sized at the finest layer the slicer offers and its default prime volume, if the project's are
// less, so it's larger than any profile's.
const PLACED_LAYER_HEIGHT = 0.08;
const PLACED_PRIME_VOLUME = 45;
// Room for line width and rounding at the bed's edge.
const SLACK = 2;
// Clearance from the objects that counts as enough; among spots with that much, the one nearest the slicer's own
// default (back of the bed, right of centre) is taken.
const CLEARANCE = 10;
const HOME: [number, number] = [0.644, 0.977];
const STEP = 2;

function minDepth(height: number): number {
  const [first] = MIN_DEPTH_BY_HEIGHT;
  if (height <= first[0]) return first[1];
  for (let i = 1; i < MIN_DEPTH_BY_HEIGHT.length; i++) {
    const [h0, d0] = MIN_DEPTH_BY_HEIGHT[i - 1];
    const [h1, d1] = MIN_DEPTH_BY_HEIGHT[i];
    if (height < h1) return d0 + ((height - h0) / (h1 - h0)) * (d1 - d0);
  }
  return MIN_DEPTH_BY_HEIGHT[MIN_DEPTH_BY_HEIGHT.length - 1][1];
}

function positive(value: unknown, fallback: number): number {
  const n = Number.parseFloat(String(firstValue(value) ?? ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  const v = firstValue(value);
  if (v === undefined || v === null || v === "") return fallback;
  return !(v === "0" || v === 0 || v === false || v === "false");
}

export function towerSettings(settings: Settings): TowerSettings {
  const volumes = asArray(settings.filament_prime_volume)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const saving = firstValue(settings.prime_volume_mode) === "Saving";
  const processHeight = processNameParts(String(firstValue(settings.print_settings_id) ?? "")).height;
  return {
    primeVolume: saving ? 15 : volumes.length ? Math.max(...volumes) : 45,
    layerHeight: positive(settings.layer_height, processHeight ?? 0.2),
    infillGap: positive(settings.prime_tower_infill_gap, 150) / 100,
    ribWall: flag(settings.prime_tower_rib_wall, true),
    ribWidth: positive(settings.prime_tower_rib_width, 8),
    extraRibLength: Number(firstValue(settings.prime_tower_extra_rib_length)) || 0,
    width: positive(settings.prime_tower_width, 35),
    brim: positive(settings.prime_tower_brim_width, 3),
    nozzles: Math.max(asArray(settings.nozzle_diameter).length, 1),
  };
}

/** The tower's width and depth, brim excluded. */
export function towerSize(plate: TowerPlate, s: TowerSettings): [number, number] {
  const changes = s.nozzles === 2 ? plate.filaments : plate.filaments - 1;
  const volume = s.primeVolume * Math.max(changes, 1);
  if (s.ribWall) {
    const volumeDepth = Math.sqrt((volume / s.layerHeight) * s.infillGap);
    const depth = Math.max(volumeDepth, minDepth(plate.height));
    const side = Math.min(s.ribWidth, depth / 2) / Math.SQRT2 + Math.max(depth + s.extraRibLength, volumeDepth);
    return [side, side];
  }
  return [s.width, Math.max((volume / (s.layerHeight * s.width)) * s.infillGap, minDepth(plate.height))];
}

/** The settings a tower placed here is sized by. */
const placed = (s: TowerSettings): TowerSettings => ({
  ...s,
  layerHeight: Math.min(s.layerHeight, PLACED_LAYER_HEIGHT),
  primeVolume: Math.max(s.primeVolume, PLACED_PRIME_VOLUME),
});

/** The tower with its corner at (x, y), its brim included. */
export function towerFootprint(x: number, y: number, [width, depth]: [number, number], brim: number): Box2 {
  return { minX: x - brim, minY: y - brim, maxX: x + width + brim, maxY: y + depth + brim };
}

// How far a tower may reach over what's on the bed and still be clear: the grid's cell, as it takes all of a cell an
// object only reaches into, and the slicer only refuses lines that cross, which takes about a line's width more.
const TOUCH = 1;

/** Whether a tower with its corner at (x, y), as the project's settings size it, stays on the bed and off everything
 *  on the plate. */
export function towerClear(plate: TowerPlate, bed: BedBox, s: TowerSettings, x: number, y: number): boolean {
  const tower = towerFootprint(x, y, towerSize(plate, s), s.brim);
  const onBed = tower.minX >= bed.minX && tower.minY >= bed.minY && tower.maxX <= bed.maxX && tower.maxY <= bed.maxY;
  const inner = {
    minX: tower.minX + TOUCH,
    minY: tower.minY + TOUCH,
    maxX: tower.maxX - TOUCH,
    maxY: tower.maxY - TOUCH,
  };
  return onBed && clearance(plate.footprint, inner) > 0;
}

function steps(lo: number, hi: number): number[] {
  if (hi <= lo) return [lo];
  const out: number[] = [];
  for (let v = lo; v < hi; v += STEP) out.push(v);
  out.push(hi);
  return out;
}

/** The corner of a tower on `plate` where it keeps furthest from the plate's objects, up to CLEARANCE, sized larger
 *  than the project's settings size it. */
export function towerSpot(plate: TowerPlate, bed: BedBox, s: TowerSettings): [number, number] {
  const size = towerSize(plate, placed(s));
  const edge = s.brim + SLACK;
  const lo: [number, number] = [bed.minX + edge, bed.minY + edge];
  const hi: [number, number] = [Math.max(bed.maxX - size[0] - edge, lo[0]), Math.max(bed.maxY - size[1] - edge, lo[1])];
  const home = [0, 1].map((axis) => {
    const [min, max] = axis ? [bed.minY, bed.maxY] : [bed.minX, bed.maxX];
    return Math.min(Math.max(min + HOME[axis] * (max - min), lo[axis]), hi[axis]);
  });
  let best: [number, number] = [home[0], home[1]];
  let bestScore = -Infinity;
  let bestDistance = Infinity;
  for (const x of steps(lo[0], hi[0]))
    for (const y of steps(lo[1], hi[1])) {
      const tower = towerFootprint(x, y, size, s.brim);
      const score = clearance(plate.footprint, tower, CLEARANCE);
      const distance = Math.hypot(x - home[0], y - home[1]);
      if (score > bestScore + 1e-9 || (score > bestScore - 1e-9 && distance < bestDistance)) {
        best = [x, y];
        bestScore = score;
        bestDistance = distance;
      }
    }
  return best;
}
