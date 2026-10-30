// Turns a measured mesh into the two numbers a price is built from: grams of filament and hours on the printer.
//
// A slicer gets these by slicing; this works them out from the solid, which is why the window calls them an estimate
// and takes the slicer's own figures over its own whenever a sliced file is dropped. The arithmetic is the one a
// slicer's own time estimate uses, with the detail left out:
//
//   material = the solid skin (walls, top and bottom) + what the infill puts inside it
//   time     = that volume divided by how fast the nozzle can lay it down, plus the per-layer overhead
//
// Both are deliberately simple and both have a dial the person can turn until the estimate matches a real slice:
// `efficiency` for the speed actually reached, `perLayer` for everything that isn't extruding.

/** A printer and the way it prints: the figures that don't change from part to part. */
export const PRINTER = {
  name: "Printer",
  // What it costs to own and run.
  price: 700,
  lifespan: 3000,
  watts: 110,
  kwhPrice: 0.15,
  failRate: 8,
  // The bed, which says whether a part fits.
  bedX: 256,
  bedY: 256,
  bedZ: 256,
  // How it prints, which decides the material and the time.
  layerHeight: 0.2,
  lineWidth: 0.42,
  walls: 2,
  solidLayers: 4,
  infill: 15,
  speed: 150,
  efficiency: 55,
  perLayer: 4,
  supports: true,
  overhang: 45,
  supportDensity: 15,
};

/** A filament: what it weighs and what it costs. */
export const MATERIAL = {
  name: "PLA",
  density: 1.24,
  spoolPrice: 20,
  spoolWeight: 1000,
};

/** The densities of the common filaments, g/cm³, as the spool makers give them. */
export const DENSITIES = {
  PLA: 1.24,
  "PLA Silk": 1.23,
  "PLA-CF": 1.22,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  Nylon: 1.14,
  "Nylon-CF": 1.17,
  PC: 1.2,
  PVA: 1.23,
  HIPS: 1.04,
  "Wood PLA": 1.28,
  "Metal-filled PLA": 2.5,
};

const MM3_PER_CM3 = 1000;

/**
 * The print, from a measurement (geometry.js) and a printer. Volumes are cubic millimetres, weights grams, time
 * seconds.
 */
export function estimate(measurement, printer) {
  const p = { ...PRINTER, ...printer };
  const layerHeight = Math.max(0.02, p.layerHeight);
  const lineWidth = Math.max(0.1, p.lineWidth);

  // The solid shell: so many layers thick where the surface faces up or down, so many lines thick where it stands up.
  // The two are added over the surface projected each way, which counts the corners where a wall meets a top twice —
  // a few per cent high on a small part, and the side to err on for a price.
  const solidSkin = Math.max(0, p.solidLayers) * layerHeight;
  const wallSkin = Math.max(0, p.walls) * lineWidth;
  const skinVolume = Math.min(measurement.volume, measurement.skin.up * solidSkin + measurement.skin.side * wallSkin);
  // Thin enough and the shells meet in the middle: then it prints solid and there's no inside left to fill.
  const inside = Math.max(0, measurement.volume - skinVolume);
  const infillVolume = inside * (Math.min(Math.max(p.infill, 0), 100) / 100);
  const supportVolume = p.supports ? measurement.support.volume * (Math.max(p.supportDensity, 0) / 100) : 0;

  const partVolume = skinVolume + infillVolume;
  const extruded = partVolume + supportVolume;
  const density = Math.max(0.1, p.density ?? MATERIAL.density);
  const grams = (partVolume / MM3_PER_CM3) * density;
  const supportGrams = (supportVolume / MM3_PER_CM3) * density;

  // What the nozzle can lay down: a bead of lineWidth by layerHeight, moved at the speed actually reached. The
  // nominal speed is never held through a whole layer — the printer is forever accelerating into a corner — so
  // `efficiency` is the share of it that counts, and it's the dial to turn against a real slice.
  const flow = lineWidth * layerHeight * Math.max(1, p.speed) * (Math.min(Math.max(p.efficiency, 5), 100) / 100);
  const layers = Math.max(1, Math.ceil(measurement.box.size[2] / layerHeight));
  // Everything that isn't extruding: travel between parts of a layer, the Z move, the seam, retractions.
  const overhead = layers * Math.max(0, p.perLayer);
  const seconds = extruded / flow + overhead;

  return {
    skinVolume,
    infillVolume,
    supportVolume,
    partVolume,
    extruded,
    grams,
    supportGrams,
    totalGrams: grams + supportGrams,
    flow,
    layers,
    overhead,
    seconds,
    solid: inside === 0,
  };
}
