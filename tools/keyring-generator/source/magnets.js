// Magnets sunk into the back of a keyring, so it sticks to a fridge or a toolboard.

/** Sizes magnets are commonly sold in: width across, then thickness, in mm. */
export const MAGNET_SIZES = [
  [2, 1],
  [2, 2],
  [3, 1],
  [4, 1],
  [4, 1.5],
  [5, 1],
  [5, 2],
  [5, 3],
  [6, 2],
  [6, 3],
  [8, 1],
  [8, 2],
  [8, 3],
];

/** The magnets asked for, each brought inside what can actually be made. */
export const normalizeMagnets = (settings) =>
  (Array.isArray(settings.magnets) ? settings.magnets : []).slice(0, 6).map((magnet) => ({
    diameter: Math.max(2, Math.min(8, +magnet.diameter || 6)),
    depth: Math.max(0.5, Math.min(5, +magnet.depth || 2)),
    x: Math.max(-1, Math.min(1, +magnet.x || 0)),
    y: Math.max(-1, Math.min(1, +magnet.y || 0)),
  }));

/** How thick the base has to be to hold the deepest magnet, with material left under it. */
export function magnetMinimum(settings) {
  const magnets = normalizeMagnets(settings);
  if (!settings.magnetEnabled || !magnets.length) return 0.4;
  const deepest = Math.max(...magnets.map((magnet) => magnet.depth));
  const needed = deepest + (+settings.magnetDepthGap || 0) + 0.6 + (settings.magnetMode === "embedded" ? 0.4 : 0);
  return Math.ceil(needed * 10 - 1e-8) / 10;
}

/** The base thickness actually used: the one asked for, or thicker if the magnets need it. */
export function effectiveBase(settings) {
  if (!settings.magnetEnabled || !normalizeMagnets(settings).length) return +settings.base;
  if (settings.magnetAutoHeight !== false) return magnetMinimum(settings);
  return Math.max(+settings.magnetBase || +settings.base, magnetMinimum(settings));
}
