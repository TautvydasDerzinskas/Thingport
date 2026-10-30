// Measures a mesh: the numbers an estimate is built on. Everything here is pure arithmetic over the triangle array
// mesh.js produces, so it runs the same in the tool and in the tests.
//
// The part is measured once, at its own size; a scale the person types is applied afterwards by `scaled`, because
// every figure below scales by a known power of the factor (lengths by s, areas by s², volumes by s³) and rescaling
// a million triangles on every keystroke would not.

/** Triangles whose faces have no neighbour for every edge: the mesh check is skipped above this, as the map of edges
 *  costs more than the answer is worth on a mesh that large. */
const EDGE_CHECK_LIMIT = 400_000;

/** A face this close to the bottom of the part is resting on the plate, and needs nothing under it. */
const ON_THE_PLATE = 0.1;

const area2 = (ax, ay, az, bx, by, bz) => Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);

/**
 * Measures the triangles. Returns millimetres, square millimetres and cubic millimetres:
 *
 * - `volume`     how much plastic the solid holds, were it printed solid
 * - `area`       its surface
 * - `skin`       { flat, wall } the surface split for display, and { up, side } projected, for the material estimate
 * - `box`        { min, max, size } the box round it
 * - `closed`     true when every edge has exactly one neighbour, false when it hasn't, null when unchecked
 * - `inverted`   the winding points inward (the signed volume came out negative)
 * - `support`    { area, volume } the overhang that needs holding up, from `overhang` degrees
 * - `faces`      a Uint8Array, one per triangle: 1 where it needs holding up, for the viewer to colour
 */
export function measure(triangles, options = {}) {
  const overhang = options.overhang ?? 45;
  const count = Math.floor(triangles.length / 9);
  // A face overhangs when its slope from the plate is shallower than the threshold, which for a face whose normal
  // points down by nz means |nz| above the cosine of that angle: flat down (|nz| = 1) is the worst case, a vertical
  // wall (nz = 0) never needs support.
  const limit = Math.cos((overhang * Math.PI) / 180);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let signed = 0;
  let area = 0;
  let flat = 0;
  let wall = 0;
  let up = 0;
  let side = 0;
  let supportArea = 0;
  let supportVolume = 0;
  const faces = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const at = i * 9;
    const ax = triangles[at];
    const ay = triangles[at + 1];
    const az = triangles[at + 2];
    const bx = triangles[at + 3];
    const by = triangles[at + 4];
    const bz = triangles[at + 5];
    const cx = triangles[at + 6];
    const cy = triangles[at + 7];
    const cz = triangles[at + 8];

    for (let v = 0; v < 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = triangles[at + v * 3 + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }

    // The volume of the tetrahedron from the origin to the face, added up over a closed mesh, is the solid's volume:
    // the parts outside it cancel. Its sign says which way the faces are wound.
    signed += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const cross = area2(ux, uy, uz, vx, vy, vz);
    if (!(cross > 0)) continue; // A degenerate triangle has no area and no normal.
    const faceArea = cross / 2;
    area += faceArea;

    // The normal's z alone decides how the face is skinned and whether it overhangs.
    const nz = (ux * vy - uy * vx) / cross;
    const upward = Math.abs(nz);
    // Split for display: within 45° of horizontal counts as a top or bottom surface.
    if (upward >= 0.7071) flat += faceArea;
    else wall += faceArea;
    // The same surface projected two ways, which is what the material estimate multiplies by its skin thicknesses:
    // a solid top or bottom is so many layers measured straight down, a wall so many lines measured sideways.
    up += faceArea * upward;
    side += faceArea * Math.sqrt(Math.max(0, 1 - nz * nz));

    // Which faces overhang is known here; how much support each needs isn't, until the bottom of the part is, so
    // that is counted in a second pass below.
    if (nz < 0 && upward > limit) faces[i] = 1;
  }

  const empty = !count || min[0] === Infinity;
  const box = empty
    ? { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] }
    : { min, max, size: max.map((value, axis) => value - min[axis]) };

  // Now the bottom of the part is known, the support under each overhanging face can be: a slicer drops a part onto
  // the bed, so what has to be printed under a face is its height above the part's own base, not above wherever the
  // file happened to put it. A face resting on the plate needs none, and is no longer marked as overhanging.
  const base = empty ? 0 : min[2];
  for (let i = 0; i < count; i++) {
    if (!faces[i]) continue;
    const at = i * 9;
    const ux = triangles[at + 3] - triangles[at];
    const uy = triangles[at + 4] - triangles[at + 1];
    const uz = triangles[at + 5] - triangles[at + 2];
    const vx = triangles[at + 6] - triangles[at];
    const vy = triangles[at + 7] - triangles[at + 1];
    const vz = triangles[at + 8] - triangles[at + 2];
    const cross = area2(ux, uy, uz, vx, vy, vz);
    // The face's own area projected onto the plate: the footprint the support stands on.
    const projected = Math.abs(ux * vy - uy * vx) / 2;
    const height = (triangles[at + 2] + triangles[at + 5] + triangles[at + 8]) / 3 - base;
    if (height <= ON_THE_PLATE) {
      faces[i] = 0;
      continue;
    }
    supportArea += projected;
    // Everything from the plate up to the face, which is the most it could be: anything printed below holds some of
    // it up, and the support density the estimate applies brings it down to a usable figure.
    supportVolume += projected * height;
    if (cross <= 0) faces[i] = 0;
  }

  let closed = null;
  if (count && count <= EDGE_CHECK_LIMIT) closed = isClosed(triangles, count);

  return {
    count,
    volume: Math.abs(signed),
    inverted: signed < 0,
    area,
    skin: { flat, wall, up, side },
    box,
    closed,
    support: { area: supportArea, volume: supportVolume },
    faces,
  };
}

/** Every edge used once in each direction: a mesh that is, holds a volume worth trusting. */
function isClosed(triangles, count) {
  // Vertices are matched on their coordinates rounded to a micron, so the same corner written twice with a float's
  // last bit different still counts as one.
  const key = (at) =>
    `${Math.round(triangles[at] * 1000)},${Math.round(triangles[at + 1] * 1000)},${Math.round(triangles[at + 2] * 1000)}`;
  const edges = new Map();
  for (let i = 0; i < count; i++) {
    const at = i * 9;
    const corners = [key(at), key(at + 3), key(at + 6)];
    for (let c = 0; c < 3; c++) {
      const from = corners[c];
      const to = corners[(c + 1) % 3];
      if (from === to) continue;
      // One counter a pair of corners, +1 one way and -1 the other: a closed mesh leaves every pair at zero.
      const pair = from < to ? `${from}|${to}` : `${to}|${from}`;
      const step = from < to ? 1 : -1;
      const now = (edges.get(pair) ?? 0) + step;
      if (now === 0) edges.delete(pair);
      else edges.set(pair, now);
    }
  }
  return edges.size === 0;
}

/** The same measurements at a scale, without touching the triangles again. */
export function scaled(measurement, percent) {
  const s = (Number(percent) || 100) / 100;
  if (s === 1) return measurement;
  const s2 = s * s;
  const s3 = s2 * s;
  return {
    ...measurement,
    volume: measurement.volume * s3,
    area: measurement.area * s2,
    skin: {
      flat: measurement.skin.flat * s2,
      wall: measurement.skin.wall * s2,
      up: measurement.skin.up * s2,
      side: measurement.skin.side * s2,
    },
    box: {
      min: measurement.box.min.map((v) => v * s),
      max: measurement.box.max.map((v) => v * s),
      size: measurement.box.size.map((v) => v * s),
    },
    support: { area: measurement.support.area * s2, volume: measurement.support.volume * s3 },
  };
}

/** Whether the part fits the bed, flat or turned a quarter turn, and what scale would make it. */
export function fits(size, bed) {
  const [x, y, z] = size;
  const flat = x <= bed.x && y <= bed.y;
  const turned = y <= bed.x && x <= bed.y;
  const tall = z <= bed.z;
  const room = Math.min(bed.x / (x || 1), bed.y / (y || 1), bed.z / (z || 1));
  return { fits: (flat || turned) && tall, turned: !flat && turned, tall, room };
}
