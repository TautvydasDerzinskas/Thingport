import { describe, expect, it } from "vitest";
import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from "manifold-3d";
import type { Own } from "./solids";
import { isoPitch, threadSolid, threadTriangles, type ThreadSpec } from "./threads";

// ISO metric threads: a rod's size, which way each hand climbs, that a rod fits the hole cut for it, the lead-ins at
// the ends, the standard pitches, and what's refused.

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

const M8: ThreadSpec = {
  diameter: 8,
  pitch: 1.25,
  length: 20,
  internal: false,
  clearance: 0,
  hand: "right",
  chamfer: false,
  segments: 64,
};

// ISO 68-1's diameters for M8 × 1.25.
const ROD_ROOT = 8 - 1.22687 * 1.25;
const NUT_MINOR = 8 - 1.08253 * 1.25;

type Make = (spec: Partial<ThreadSpec>) => Manifold;

/** Runs `test` with a way to make threads, each checked to be a solid, that frees them afterwards. */
async function withThreads(test: (make: Make, own: Own) => void) {
  const module: ManifoldToplevel = await wasm;
  const made: { delete(): void }[] = [];
  const own: Own = (value) => {
    made.push(value);
    return value;
  };
  const make: Make = (changes) => {
    const spec = { ...M8, ...changes };
    const solid = threadSolid(module, own, spec);
    expect(solid.status()).toBe("NoError");
    expect(solid.isEmpty()).toBe(false);
    return solid;
  };
  try {
    test(make, own);
  } finally {
    for (const each of made) each.delete();
  }
}

const radii = (section: CrossSection) =>
  section.toPolygons().flatMap((polygon) => polygon.map((p) => Math.hypot(...p)));

/** Where a section's area is centred, in degrees round Z from +X. */
function centreAngle(section: CrossSection): number {
  let [x, y, area] = [0, 0, 0];
  for (const polygon of section.toPolygons()) {
    polygon.forEach(([x0, y0], i) => {
      const [x1, y1] = polygon[(i + 1) % polygon.length];
      const a = x0 * y1 - x1 * y0;
      area += a;
      x += (x0 + x1) * a;
      y += (y0 + y1) * a;
    });
  }
  return (Math.atan2(y / area, x / area) * 180) / Math.PI;
}

/** How far `a` is round from `b`, in degrees, -180 to 180. */
const turned = (a: number, b: number) => ((((a - b + 180) % 360) + 360) % 360) - 180;

describe("Studio threads", () => {
  it("makes an M8 rod as wide as M8, down to its root, as long as asked", async () => {
    await withThreads((make, own) => {
      const rod = make({});
      const { min, max } = rod.boundingBox();
      expect(max[0] - min[0]).toBeLessThanOrEqual(8 + 1e-6);
      expect(max[0] - min[0]).toBeGreaterThan(7.99);
      expect(min[2]).toBeCloseTo(0, 9);
      expect(max[2]).toBeCloseTo(20, 9);
      // Between two layers a slice is on the helix's chords, a little inside it.
      const root = Math.min(...radii(own(rod.slice(10.1)))) * 2;
      expect(root).toBeLessThanOrEqual(ROD_ROOT + 1e-6);
      expect(root).toBeGreaterThan(ROD_ROOT * 0.99);
      const volume = rod.volume();
      expect(volume).toBeGreaterThan(Math.PI * (ROD_ROOT / 2) ** 2 * 20);
      expect(volume).toBeLessThan(Math.PI * 4 ** 2 * 20);
      expect(threadTriangles(M8)).toBe(rod.numTri());
    });
  });

  it.each([
    ["right", 1],
    ["left", -1],
  ] as const)("climbs %s-handed: the crest starts on +X and turns that way round as it rises", async (hand, way) => {
    await withThreads((make, own) => {
      const rod = make({ hand, length: 5 });
      // A single start's section is lopsided towards the crest, so where its area is centred is where the crest is.
      const crestAt = (z: number) => centreAngle(own(rod.slice(z)));
      for (const [z, expected] of [
        [0.01, 0],
        [1.25 / 4, way * 90],
        [1.25 * 2.75, way * 270],
      ])
        expect(Math.abs(turned(crestAt(z), expected))).toBeLessThan(3);
      // Seen from above, a right hand turns counter-clockwise as it rises.
      expect(Math.sign(turned(crestAt(2.1), crestAt(2)))).toBe(way);
    });
  });

  it("cuts a hole the same size of rod fits in, with clearance, and only that hand", async () => {
    await withThreads((make, own) => {
      const fit = { length: 10, clearance: 0.15, segments: 48 };
      const rod = make(fit);
      const cutter = make({ ...fit, internal: true });
      expect(cutter.volume()).toBeGreaterThan(rod.volume());
      expect(own(rod.subtract(cutter)).volume()).toBeLessThan(1e-3);
      const left = make({ ...fit, hand: "left" });
      expect(own(left.subtract(cutter)).volume()).toBeGreaterThan(left.volume() * 0.01);
      // The cutter is the nut's thread space, grown by the clearance.
      const { min, max } = cutter.boundingBox();
      expect(max[0] - min[0]).toBeLessThanOrEqual(8.3 + 1e-6);
      expect(max[0] - min[0]).toBeGreaterThan(8.29);
      const minor = Math.min(...radii(own(cutter.slice(5.1)))) * 2;
      expect(minor).toBeLessThanOrEqual(NUT_MINOR + 0.3 + 1e-6);
      expect(minor).toBeGreaterThan((NUT_MINOR + 0.3) * 0.99);
    });
  });

  it("leads in at both ends: a rod's narrowed to its root, a cutter's flared out to its major", async () => {
    await withThreads((make, own) => {
      const short = { length: 10, segments: 48, chamfer: true };
      const rod = make(short);
      const cutter = make({ ...short, internal: true });
      for (const solid of [rod, cutter]) {
        const { min, max } = solid.boundingBox();
        expect(min[2]).toBeCloseTo(0, 9);
        expect(max[2]).toBeCloseTo(10, 9);
      }
      // A chamfer adds or takes off about as many triangles whatever the length: in a short thread the estimate is rougher.
      for (const [solid, internal] of [
        [rod, false],
        [cutter, true],
      ] as const)
        expect(Math.abs(threadTriangles({ ...M8, ...short, internal }) / solid.numTri() - 1)).toBeLessThan(0.05);
      const across = (solid: Manifold, z: number) => radii(own(solid.slice(z)));
      expect(Math.max(...across(rod, 5.1))).toBeGreaterThan(4 * 0.99);
      expect(Math.min(...across(cutter, 5.1)) * 2).toBeLessThanOrEqual(NUT_MINOR + 1e-6);
      for (const end of [0.02, 9.98]) {
        expect(Math.max(...across(rod, end)) * 2).toBeLessThan(ROD_ROOT + 0.02);
        expect(Math.min(...across(cutter, end)) * 2).toBeGreaterThan(7.95);
      }
    });
  });

  it("makes the smallest, the largest and the shortest it allows", async () => {
    await withThreads((make) => {
      for (const internal of [false, true]) {
        for (const chamfer of [false, true]) {
          for (const size of [
            { diameter: 1, pitch: isoPitch(1), length: 1, clearance: 0.1, segments: 48 },
            { diameter: 200, pitch: 6, length: 12, segments: 48 },
            { length: 1.25, hand: "left" as const },
          ])
            expect(make({ ...size, internal, chamfer }).boundingBox().max[2]).toBeCloseTo(size.length, 9);
        }
      }
    });
  });

  it("knows ISO 261's coarse pitches, and the nearest standard size's for any other", () => {
    expect([3, 8, 10, 12].map(isoPitch)).toEqual([0.5, 1.25, 1.5, 1.75]);
    expect(isoPitch(7.3)).toBe(1);
    expect(isoPitch(0.5)).toBe(0.25);
    expect(isoPitch(150)).toBe(6);
  });

  it.each([
    ["a pitch of 0", { pitch: 0 }, /pitch has to be more than 0/],
    ["a pitch over a third of the diameter", { pitch: 3 }, /at most a third of the diameter, 2\.667 mm here.*1\.25 mm/],
    ["shorter than a pitch", { length: 1 }, /at least one pitch \(1\.25 mm\) long/],
    ["over 1,000 turns", { pitch: 0.25, length: 300 }, /1200 turns, more than the 1,000/],
    ["too thin", { diameter: 0.5, pitch: 0.1 }, /diameter has to be from 1 to 200 mm/],
    ["too wide", { diameter: 250 }, /diameter has to be from 1 to 200 mm/],
    ["a negative clearance", { clearance: -0.1 }, /clearance has to be from 0 to 1 mm/],
    ["a clearance over 1 mm", { clearance: 1.5 }, /clearance has to be from 0 to 1 mm/],
    ["a clearance that eats the rod", { diameter: 1, pitch: 0.25, clearance: 0.3 }, /too much for this rod/],
    ["too few segments", { segments: 8 }, /segments have to be a whole number from 16 to 256/],
    ["a length that isn't a number", { length: Number.NaN }, /at least one pitch/],
  ])("refuses %s, saying what to change", async (_, changes, message) => {
    const module = await wasm;
    const spec = { ...M8, ...changes };
    expect(() => threadSolid(module, (value) => value, spec)).toThrow(message);
    expect(threadTriangles(spec)).toBe(0);
  });
});
