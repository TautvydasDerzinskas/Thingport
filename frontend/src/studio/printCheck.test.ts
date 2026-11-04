import { describe, expect, it } from "vitest";
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import { checkPrint, type PrintCheckOptions } from "./printCheck";
import { edgeWork, type Own } from "./solids";
import { analyze } from "./topology";
import type { Vec3 } from "./vec";

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

const OPTIONS: PrintCheckOptions = { bed: [220, 220, 250], overhang: 45, minWall: 0.8 };

type Make = (m: ManifoldToplevel, own: Own) => Record<string, Manifold>;

/** The check of the solids `make` makes, by id. All made is freed after, which fails if any was owned twice. */
async function check(make: Make, options: Partial<PrintCheckOptions> = {}) {
  const m = await wasm;
  const made: { delete(): void }[] = [];
  const own: Own = (value) => {
    made.push(value);
    return value;
  };
  try {
    const bodies = Object.entries(make(m, own)).map(([id, solid]) => ({ id, solid }));
    return checkPrint(m, own, bodies, { ...OPTIONS, ...options });
  } finally {
    for (const each of made) each.delete();
  }
}

/** A box `size` big, centred on x and y at `at`, its bottom at `at`'s z. */
const box = (m: ManifoldToplevel, own: Own, size: Vec3, at: Vec3 = [0, 0, 0]) =>
  own(own(m.Manifold.cube(size, true)).translate([at[0], at[1], at[2] + size[2] / 2]));

/** A prism 20 mm long along y, its outline in x and z, as a wedge or a tapered block is. */
const prism = (m: ManifoldToplevel, own: Own, outline: [number, number][]) =>
  own(own(own(own(m.CrossSection.ofPolygons([outline])).extrude(20)).rotate([90, 0, 0])).translate([0, 10, 0]));

const meshOf = (solid: Manifold) => {
  const mesh = solid.getMesh();
  const positions = new Float32Array((mesh.vertProperties.length / mesh.numProp) * 3);
  for (let i = 0; i < positions.length / 3; i++)
    for (let axis = 0; axis < 3; axis++) positions[i * 3 + axis] = mesh.vertProperties[i * mesh.numProp + axis];
  return { positions, indices: new Uint32Array(mesh.triVerts) };
};

/** A solid's edges rounded or bevelled as Studio's fillet and chamfer do it: outside ones cut, inside ones filled. */
function treated(
  m: ManifoldToplevel,
  own: Own,
  solid: Manifold,
  kind: "fillet" | "chamfer",
  size: number,
  inside = false,
) {
  const top = analyze(meshOf(solid));
  const edges = top.edges.flatMap((edge, i) => (edge.convex !== inside ? [i] : []));
  const work = edgeWork(m, own, top, edges, kind, size, 32);
  return inside
    ? own(solid.add(own(m.Manifold.union(work.fill))))
    : own(solid.subtract(own(m.Manifold.union(work.cut))));
}

describe("checkPrint", () => {
  it("passes a 20 mm cube standing on the bed", async () => {
    const result = await check((m, own) => ({ "box-1": box(m, own, [20, 20, 20]) }));
    expect(result).toEqual({
      bodies: [
        {
          id: "box-1",
          size: [20, 20, 20],
          volume: 8000,
          aboveBed: 0,
          belowBed: 0,
          fitsBed: true,
          pieces: 1,
          overhang: null,
          thinWalls: null,
        },
      ],
      overlaps: [],
      problems: [],
    });
  });

  it("says a floating body should come down, and measures it as it will be on the bed", async () => {
    const { bodies, problems } = await check((m, own) => ({ "box-1": box(m, own, [20, 20, 20], [0, 0, 3]) }));
    expect(bodies[0]).toMatchObject({ aboveBed: 3, belowBed: 0, fitsBed: true, overhang: null });
    expect(problems).toEqual(["box-1 is floating 3 mm above the bed: move it down (position z) so it rests on it."]);
  });

  it("says a sunk body should come up", async () => {
    const { bodies, problems } = await check((m, own) => ({ "box-1": box(m, own, [20, 20, 20], [0, 0, -2]) }));
    expect(bodies[0]).toMatchObject({ aboveBed: 0, belowBed: 2, fitsBed: false });
    expect(problems).toEqual([
      "box-1 is sunk 2 mm into the bed, so its bottom won't print: move it up (position z) so it rests on it.",
    ]);
  });

  it("counts a T's overhanging bar, and nothing that rests on the bed", async () => {
    const { bodies, problems } = await check((m, own) => ({
      "t-1": own(m.Manifold.union([box(m, own, [10, 10, 20]), box(m, own, [40, 10, 5], [0, 0, 20])])),
    }));
    expect(bodies[0].overhang!.area).toBeCloseTo(300, 3);
    expect(bodies[0].overhang!.lowest).toBe(20);
    expect(problems).toEqual([
      "t-1 has 300 mm² of overhang steeper than 45°, lowest at z = 20 mm: " +
        "it needs support there, or turning so it faces up.",
    ]);
  });

  it("measures a ball's underside as the formula does", async () => {
    const { bodies } = await check((m, own) => ({ ball: own(own(m.Manifold.sphere(10, 128)).translate([0, 0, 10])) }));
    // The band of the sphere facing down more than 45°, above the 0.4 mm the bed holds: 2πr × its height.
    const expected = 2 * Math.PI * 10 * (10 * (1 - Math.SQRT1_2) - 0.4);
    expect(bodies[0].overhang!.area).toBeGreaterThan(expected * 0.98);
    expect(bodies[0].overhang!.area).toBeLessThan(expected * 1.01);
    expect(bodies[0].overhang!.lowest).toBe(0.4);
  });

  it("goes by the overhang angle it's given", async () => {
    // A cone flaring out at 45° as it rises.
    const cone: Make = (m, own) => ({ cone: own(m.Manifold.cylinder(10, 5, 15, 64)) });
    expect((await check(cone)).bodies[0].overhang).toBeNull();
    const steeper = await check(cone, { overhang: 30 });
    expect(steeper.bodies[0].overhang!.area).toBeGreaterThan(850);
    expect(steeper.problems[0]).toMatch(/^cone has 8\d\d mm² of overhang steeper than 30°/);
  });

  it("finds a 0.4 mm plate too thin, and a 2 mm one not", async () => {
    const thin = await check((m, own) => ({ "plate-1": box(m, own, [20, 20, 0.4]) }));
    expect(thin.bodies[0].thinWalls).toEqual({ area: 400, thinnest: 0.4 });
    expect(thin.problems).toEqual([
      "plate-1 has walls down to 0.4 mm, thinner than 0.8 mm (400 mm² of them): they may not print.",
    ]);
    const thick = await check((m, own) => ({ "plate-1": box(m, own, [20, 20, 2]) }));
    expect(thick.bodies[0].thinWalls).toBeNull();
    expect(thick.problems).toEqual([]);
  });

  it("doesn't take a filleted or chamfered block's edges for thin walls, finely meshed or not", async () => {
    const { bodies, problems } = await check((m, own) => {
      const block = box(m, own, [20, 20, 20]);
      const rounded = treated(m, own, block, "fillet", 2);
      const bevelled = treated(m, own, block, "chamfer", 2);
      // A 1.2 mm wall with its edges rounded, thick enough everywhere.
      const wall = treated(m, own, box(m, own, [1.2, 20, 15]), "fillet", 0.5);
      const solids = {
        rounded,
        bevelled,
        wall,
        "rounded-fine": own(rounded.refineToLength(1)),
        "bevelled-fine": own(bevelled.refineToLength(1)),
      };
      // Side by side, so none overlaps another.
      return Object.fromEntries(
        Object.entries(solids).map(([id, solid], i) => [id, own(solid.translate([i * 30 - 60, 0, 0]))]),
      );
    });
    for (const body of bodies) expect({ [body.id]: body.thinWalls }).toEqual({ [body.id]: null });
    // A 45° chamfer is at the limit, and a small fillet along the bottom is within what the bed holds.
    expect(problems).toEqual([]);
  });

  it("doesn't take a sharp edge for a wall, but does a knife edge", async () => {
    const { bodies } = await check((m, own) => {
      const lean = 10 / Math.tan((70 * Math.PI) / 180);
      return {
        // A block whose sides lean in at 20°: its bottom edges are 70°, so a ray from near one leaves through the
        // other face only 20° off along it.
        tapered: own(
          prism(m, own, [
            [-10, 0],
            [10, 0],
            [10 - lean, 10],
            [-10 + lean, 10],
          ]).refineToLength(0.5),
        ),
        // A 20° wedge: the 2.2 mm nearest its edge are under 0.8 mm thick.
        wedge: own(
          prism(m, own, [
            [-10, 0],
            [10, 0],
            [10, 20 * Math.tan((20 * Math.PI) / 180)],
          ]).refineToLength(0.5),
        ),
      };
    });
    expect(bodies[0].thinWalls).toBeNull();
    expect(bodies[1].thinWalls!.area).toBeGreaterThan(40);
    expect(bodies[1].thinWalls!.area).toBeLessThan(48);
    expect(bodies[1].thinWalls!.thinnest).toBeLessThan(0.1);
  });

  it("doesn't let the slivers at a filled inside corner's ends pass for the thinnest wall", async () => {
    const { bodies } = await check((m, own) => {
      const ell = own(m.Manifold.union([box(m, own, [20, 20, 4], [10, 10, 0]), box(m, own, [4, 20, 20], [2, 10, 0])]));
      const filled = treated(m, own, ell, "fillet", 2, true);
      return { filled, "with-fin": own(filled.add(box(m, own, [0.5, 10, 10], [15, 10, 4]))) };
    });
    expect(bodies[0].thinWalls).toBeNull();
    expect(bodies[1].thinWalls!.area).toBeCloseTo(100, 0);
    expect(bodies[1].thinWalls!.thinnest).toBeCloseTo(0.5, 3);
  });

  it("finds bodies that overlap without being joined, not ones that only touch", async () => {
    const { overlaps, problems } = await check((m, own) => ({
      "box-1": box(m, own, [20, 20, 20]),
      "cylinder-2": box(m, own, [20, 20, 20], [10, 0, 0]),
      "box-3": box(m, own, [20, 20, 20], [0, 20, 0]),
    }));
    expect(overlaps).toEqual([{ a: "box-1", b: "cylinder-2", volume: 4000 }]);
    expect(problems).toEqual(["box-1 and cylinder-2 overlap by 4000 mm³ without being joined: union them."]);
  });

  it("says what doesn't fit the bed, and how it might", async () => {
    const wide = await check((m, own) => ({ "mesh-3": box(m, own, [300, 100, 50]) }));
    expect(wide.bodies[0].fitsBed).toBe(false);
    expect(wide.problems).toEqual([
      "mesh-3 doesn't fit the 220 × 220 × 250 mm bed: it's 300 mm wide. Scale it down or split it.",
    ]);
    const tall = await check((m, own) => ({ "mesh-3": box(m, own, [100, 100, 240]) }), { bed: [250, 250, 200] });
    expect(tall.problems).toEqual([
      "mesh-3 doesn't fit the 250 × 250 × 200 mm bed: it's 240 mm tall. Turned onto another side, it would fit.",
    ]);
    const long = await check((m, own) => ({ "mesh-3": box(m, own, [230, 100, 50]) }), { bed: [220, 250, 250] });
    expect(long.problems).toEqual([
      "mesh-3 doesn't fit the 220 × 250 × 250 mm bed: it's 230 mm wide. Turned 90° about z, it would fit.",
    ]);
    const off = await check((m, own) => ({ "box-1": box(m, own, [20, 20, 20], [105, -103, 0]) }));
    expect(off.bodies[0].fitsBed).toBe(false);
    expect(off.problems).toEqual([
      "box-1 runs off the bed by 5 mm in x and 3 mm in y: " +
        "move it (position x and y) back onto the 220 × 220 mm bed, which is centred on x = y = 0.",
    ]);
  });

  it("counts loose pieces, and a hollow as part of the piece around it", async () => {
    const { bodies, problems } = await check((m, own) => ({
      "part-5": own(m.Manifold.union([box(m, own, [10, 10, 10]), box(m, own, [10, 10, 10], [30, 0, 0])])),
      hollow: own(box(m, own, [20, 20, 20]).subtract(box(m, own, [16, 16, 16], [0, 0, 2]))),
    }));
    expect(bodies.map((body) => body.pieces)).toEqual([2, 1]);
    expect(problems).toContain("part-5 is in 2 loose pieces: join them if it's meant to be one.");
    expect(problems.filter((problem) => problem.startsWith("hollow"))).toEqual([
      "hollow has 256 mm² of overhang steeper than 45°, lowest at z = 18 mm: " +
        "it needs support there, or turning so it faces up.",
    ]);
  });

  it("lists the worst first", async () => {
    const { problems } = await check((m, own) => ({
      "plate-1": box(m, own, [20, 20, 0.4], [0, 0, 5]),
      "box-2": box(m, own, [20, 20, 20], [50, 0, 0]),
      "box-3": box(m, own, [20, 20, 20], [60, 0, 0]),
      empty: own(box(m, own, [1, 1, 1]).subtract(box(m, own, [2, 2, 2], [0, 0, -0.5]))),
    }));
    expect(problems).toHaveLength(4);
    expect(problems[0]).toBe("empty is empty: there's nothing to print.");
    expect(problems[1]).toMatch(/^plate-1 is floating 5 mm above the bed/);
    expect(problems[2]).toMatch(/^box-2 and box-3 overlap by 4000 mm³/);
    expect(problems[3]).toMatch(/^plate-1 has walls down to 0.4 mm/);
  });
});
