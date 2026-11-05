import { describe, expect, it } from "vitest";
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import type { Own } from "./solids";
import { loftSolid, sweepSolid } from "./sweep";
import type { Vec2, Vec3 } from "./vec";

// Lofts and sweeps against volumes worked out another way: prisms and frustums, and Pappus (area times the length of
// the path its middle follows).

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

/** What a solid made with a fresh `own` measures, everything it made freed after. */
async function measure(make: (wasm: ManifoldToplevel, own: Own) => Manifold) {
  const made: { delete(): void }[] = [];
  const own: Own = (value) => {
    made.push(value);
    return value;
  };
  try {
    const solid = make(await wasm, own);
    const box = solid.boundingBox();
    return {
      volume: solid.volume(),
      genus: solid.genus(),
      status: solid.status(),
      triangles: solid.numTri(),
      min: [...box.min] as Vec3,
      max: [...box.max] as Vec3,
    };
  } finally {
    for (const each of made) each.delete();
  }
}

const loft = (loops: Vec3[][]) => measure((m, own) => loftSolid(m, own, loops));
const sweep = (contours: Vec2[][], path: Vec3[], closed = false, smooth = false) =>
  measure((m, own) => sweepSolid(m, own, contours, path, { closed, smooth }));

const square = (side: number, z: number, start = 0): Vec3[] => {
  const h = side / 2;
  const corners: Vec3[] = [
    [-h, -h, z],
    [h, -h, z],
    [h, h, z],
    [-h, h, z],
  ];
  return [...corners.slice(start), ...corners.slice(0, start)];
};
const circle = (r: number, segments = 64): Vec2[] =>
  Array.from({ length: segments }, (_, i): Vec2 => {
    const a = (i / segments) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
/** The area of a circle drawn with `segments` straight sides, as the profiles here are. */
const circleArea = (r: number, segments = 64) => (segments / 2) * r * r * Math.sin((2 * Math.PI) / segments);
const rectangle = (w: number, h: number): Vec2[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];
/** Points on an arc in the XY plane about the origin, from +X round towards +Y. */
const arc = (radius: number, degrees: number, points: number): Vec3[] =>
  Array.from({ length: points }, (_, i): Vec3 => {
    const a = ((degrees * Math.PI) / 180) * (i / (points - 1));
    return [radius * Math.cos(a), radius * Math.sin(a), 0];
  });
const near = (value: number, expected: number, fraction: number) =>
  expect(Math.abs(value - expected) / expected).toBeLessThan(fraction);

describe("loftSolid", () => {
  it("lofts two squares into a box", async () => {
    const solid = await loft([square(20, 0), square(20, 10)]);
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(0);
    expect(solid.volume).toBeCloseTo(4000, 3);
  });

  it("lofts a circle into a square, its volume between the two prisms'", async () => {
    const ring = circle(10).map(([x, y]): Vec3 => [x, y, 0]);
    const solid = await loft([ring, square(20, 20)]);
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(0);
    expect(solid.volume).toBeGreaterThan(circleArea(10) * 20);
    expect(solid.volume).toBeLessThan(400 * 20);
    expect(solid.min).toEqual([expect.closeTo(-10, 4), expect.closeTo(-10, 4), expect.closeTo(0, 4)]);
    expect(solid.max[2]).toBeCloseTo(20, 4);
  });

  it("lofts through three outlines: two frustums", async () => {
    const solid = await loft([square(20, 0), square(10, 10), square(20, 20)]);
    expect(solid.status).toBe("NoError");
    // A square frustum is h/3 (A1 + A2 + √(A1 A2)).
    expect(solid.volume).toBeCloseTo(2 * (10 / 3) * (400 + 100 + 200), 2);
  });

  it("lines up an outline started elsewhere, or wound the other way, instead of twisting", async () => {
    const aligned = await loft([square(20, 0), square(20, 10)]);
    const started = await loft([square(20, 0), square(20, 10, 2)]);
    const reversed = await loft([square(20, 0), square(20, 10, 1).toReversed()]);
    expect(started.volume).toBeCloseTo(aligned.volume, 3);
    expect(reversed.volume).toBeCloseTo(aligned.volume, 3);
  });

  it("comes out the right way round whichever end is given first", async () => {
    const solid = await loft([square(20, 10), square(20, 0)]);
    expect(solid.volume).toBeCloseTo(4000, 3);
  });

  it("lofts outlines that face different ways", async () => {
    // From a square on the floor to one standing up, off to the side: a bent duct.
    const standing: Vec3[] = [
      [30, -10, 20],
      [30, 10, 20],
      [30, 10, 40],
      [30, -10, 40],
    ];
    const solid = await loft([square(20, 0), standing]);
    expect(solid.status).toBe("NoError");
    expect(solid.volume).toBeGreaterThan(0);
  });

  it("refuses what isn't a loft", async () => {
    await expect(loft([square(20, 0)])).rejects.toThrow("A loft needs at least 2 outlines, got 1");
    await expect(
      loft([
        square(20, 0),
        [
          [0, 0, 5],
          [1, 0, 5],
        ],
      ]),
    ).rejects.toThrow("Outline 2 of 2 has fewer than 3 points");
    const bent = square(20, 10);
    bent[2] = [10, 10, 11];
    await expect(loft([square(20, 0), bent])).rejects.toThrow("Outline 2 of 2 isn't flat");
    // A figure of eight, one loop bigger than the other so it still has an area.
    const eight: Vec3[] = [
      [0, 0, 10],
      [20, 0, 10],
      [5, 10, 10],
      [15, 10, 10],
    ];
    await expect(loft([square(20, 0), eight])).rejects.toThrow("Outline 2 of 2 crosses itself");
    const line: Vec3[] = [
      [0, 0, 10],
      [10, 0, 10],
      [20, 0, 10],
    ];
    await expect(loft([square(20, 0), line])).rejects.toThrow("Outline 2 of 2 has no area");
    // Side by side on one plane, neither faces the other.
    const beside = square(20, 0).map(([x, y, z]): Vec3 => [x + 40, y, z]);
    await expect(loft([square(20, 0), beside])).rejects.toThrow("lies along the loft");
  });

  it("refuses a loft that doubles back on itself, or whose sides run into each other", async () => {
    await expect(loft([square(20, 0), square(20, 10), square(20, 5)])).rejects.toThrow(
      "The loft turns inside out between outlines 2 and 3",
    );
    // Out to a wider square just below the last: its end cuts through the walls under it.
    await expect(loft([square(20, 0), square(20, 10), square(40, 9.9)])).rejects.toThrow(
      "The loft's sides run into each other",
    );
  });
});

describe("sweepSolid", () => {
  it("sweeps a circle along a straight path into a cylinder", async () => {
    const solid = await sweep(
      [circle(5)],
      [
        [0, 0, 0],
        [20, 0, 0],
      ],
    );
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(0);
    near(solid.volume, Math.PI * 25 * 20, 0.01);
    expect(solid.min[0]).toBeCloseTo(0, 4);
    expect(solid.max[0]).toBeCloseTo(20, 4);
  });

  it("sweeps along a quarter arc to the volume Pappus gives, curved or in short straight pieces", async () => {
    const length = (Math.PI / 2) * 30;
    const curved = await sweep([circle(5)], arc(30, 90, 7), false, true);
    const pieces = await sweep([circle(5)], arc(30, 90, 91));
    for (const solid of [curved, pieces]) {
      expect(solid.status).toBe("NoError");
      near(solid.volume, circleArea(5) * length, 0.01);
    }
  });

  it("follows the curve more closely smooth than straight between the same points", async () => {
    const points = arc(30, 90, 4);
    const straight = await sweep([circle(5)], points);
    const smooth = await sweep([circle(5)], points, false, true);
    // Mitred straight pieces keep the area all along, so the volume is the area times the corners' path.
    const chords = 3 * 2 * 30 * Math.sin(Math.PI / 12);
    near(straight.volume, circleArea(5) * chords, 1e-4);
    const length = (Math.PI / 2) * 30;
    expect(Math.abs(smooth.volume - circleArea(5) * length)).toBeLessThan(
      Math.abs(straight.volume - circleArea(5) * length),
    );
    expect(smooth.triangles).toBeGreaterThan(straight.triangles);
  });

  it("closes a square path into a ring, mitred at the corners", async () => {
    const path: Vec3[] = [
      [-20, -20, 0],
      [20, -20, 0],
      [20, 20, 0],
      [-20, 20, 0],
    ];
    const solid = await sweep([rectangle(4, 4)], path, true);
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(1);
    // Outer square 44 wide less the inner 36, 4 thick.
    expect(solid.volume).toBeCloseTo((44 * 44 - 36 * 36) * 4, 3);
    expect(solid.min).toEqual([expect.closeTo(-22, 4), expect.closeTo(-22, 4), expect.closeTo(-2, 4)]);
    // The first point repeated at the end changes nothing.
    const repeated = await sweep([rectangle(4, 4)], [...path, path[0]], true);
    expect(repeated.volume).toBeCloseTo(solid.volume, 3);
  });

  it("closes a smooth path through points on a circle into a torus", async () => {
    const solid = await sweep([circle(5)], arc(20, 315, 8), true, true);
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(1);
    near(solid.volume, circleArea(5) * 2 * Math.PI * 20, 0.01);
  });

  it("closes a path that winds through 3D without a twist at the seam", async () => {
    // Round three faces of a box and back across it: carried round, the profile comes back turned, which the sweep
    // spreads along the path rather than leaving in one piece, where it would pinch a flat profile.
    const path: Vec3[] = [
      [0, 0, 0],
      [30, 0, 0],
      [30, 30, 0],
      [30, 30, 30],
    ];
    const length = 90 + Math.hypot(30, 30, 30);
    const solid = await sweep([rectangle(8, 1)], path, true);
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(1);
    near(solid.volume, 8 * length, 0.01);
  });

  it("sweeps a profile with a hole into a tube", async () => {
    const hole = circle(3).toReversed();
    const solid = await sweep(
      [circle(5), hole],
      [
        [0, 0, 0],
        [0, 0, 20],
      ],
    );
    expect(solid.status).toBe("NoError");
    expect(solid.genus).toBe(1);
    near(solid.volume, (circleArea(5) - circleArea(3)) * 20, 1e-4);
    // Wound the other way round, outside and hole, it reads the same.
    const flipped = await sweep(
      [circle(5).toReversed(), circle(3)],
      [
        [0, 0, 0],
        [0, 0, 20],
      ],
    );
    expect(flipped.volume).toBeCloseTo(solid.volume, 3);
  });

  it("starts the profile with v as near +Z as it goes, or +Y going straight up, and u = v × the path", async () => {
    // A small square off the profile's [0, 0]: x from 0 to 2, y from 10 to 12.
    const offset: Vec2[] = [
      [0, 10],
      [2, 10],
      [2, 12],
      [0, 12],
    ];
    const alongX = await sweep(
      [offset],
      [
        [0, 0, 0],
        [20, 0, 0],
      ],
    );
    expect(alongX.min).toEqual([expect.closeTo(0, 4), expect.closeTo(0, 4), expect.closeTo(10, 4)]);
    expect(alongX.max).toEqual([expect.closeTo(20, 4), expect.closeTo(2, 4), expect.closeTo(12, 4)]);
    const alongY = await sweep(
      [offset],
      [
        [0, 0, 0],
        [0, 20, 0],
      ],
    );
    expect(alongY.min).toEqual([expect.closeTo(-2, 4), expect.closeTo(0, 4), expect.closeTo(10, 4)]);
    const up = await sweep(
      [offset],
      [
        [0, 0, 0],
        [0, 0, 20],
      ],
    );
    expect(up.min).toEqual([expect.closeTo(0, 4), expect.closeTo(10, 4), expect.closeTo(0, 4)]);
    expect(up.max).toEqual([expect.closeTo(2, 4), expect.closeTo(12, 4), expect.closeTo(20, 4)]);
  });

  it("carries the profile round a bend without twisting it", async () => {
    // Along +X, then up: the profile's v, +Z at the start, turns with the path to point back along -X.
    const offset: Vec2[] = [
      [-1, 5],
      [1, 5],
      [1, 7],
      [-1, 7],
    ];
    const solid = await sweep(
      [offset],
      [
        [0, 0, 0],
        [40, 0, 0],
        [40, 0, 40],
      ],
    );
    expect(solid.status).toBe("NoError");
    expect(solid.max[1]).toBeCloseTo(1, 4);
    expect(solid.min[1]).toBeCloseTo(-1, 4);
    expect(solid.min[0]).toBeCloseTo(0, 4);
    expect(solid.max[0]).toBeCloseTo(40 - 5, 4);
  });

  it("refuses a path that bends too tightly for the profile", async () => {
    const corner: Vec3[] = [
      [0, 0, 0],
      [3, 0, 0],
      [3, 3, 0],
    ];
    await expect(sweep([circle(5)], corner)).rejects.toThrow(
      "The path bends too tightly for the profile at path point",
    );
    await expect(sweep([circle(5)], arc(3, 90, 5), false, true)).rejects.toThrow(
      "The path bends too tightly for the profile near path point",
    );
    await expect(
      sweep(
        [circle(1)],
        [
          [0, 0, 0],
          [20, 0, 0],
          [10, 0, 0],
        ],
      ),
    ).rejects.toThrow("The path bends too tightly for the profile at path point 2: it turns straight back");
  });

  it("refuses a path that runs back through the solid it has swept", async () => {
    // A bow tie: its two diagonals cross in the middle.
    const bowTie: Vec3[] = [
      [0, 0, 0],
      [30, 30, 0],
      [30, 0, 0],
      [0, 30, 0],
    ];
    await expect(sweep([circle(1, 16)], bowTie, true)).rejects.toThrow(
      "The path bends too tightly for the profile: the solid it sweeps runs into itself",
    );
  });

  it("refuses what isn't a sweep", async () => {
    await expect(sweep([circle(5)], [[0, 0, 0]])).rejects.toThrow("A path needs at least 2 points, got 1");
    await expect(
      sweep(
        [circle(5)],
        [
          [0, 0, 0],
          [20, 0, 0],
        ],
        true,
      ),
    ).rejects.toThrow("A closed path needs at least 3 different points, got 2");
    await expect(
      sweep(
        [circle(5)],
        [
          [0, 0, 0],
          [20, 0, 0],
          [20, 0, 0],
          [20, 20, 0],
        ],
      ),
    ).rejects.toThrow("Path points 2 and 3 of 4 are in the same place");
    const path: Vec3[] = [
      [0, 0, 0],
      [20, 0, 0],
    ];
    await expect(sweep([], path)).rejects.toThrow("The profile is empty");
    await expect(
      sweep(
        [
          [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        ],
        path,
      ),
    ).rejects.toThrow("The profile is empty");
  });
});
