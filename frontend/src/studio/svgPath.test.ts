import { describe, expect, it } from "vitest";
import { signedArea } from "./shapes2d";
import { PATH_TOLERANCE, pathContours } from "./svgPath";
import type { Vec2 } from "./vec";

// SVG path data as outlines: every command, read as the spec reads it, curves kept within the tolerance, and messages
// that say where the data went wrong.

const area = (loops: Vec2[][]) => loops.reduce((sum, loop) => sum + signedArea(loop), 0);

/** How far `point` is from the nearest piece of the closed loop. */
function distanceToLoop(point: Vec2, loop: Vec2[]): number {
  let nearest = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const [a, b] = [loop[i], loop[(i + 1) % loop.length]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
  }
  return nearest;
}

describe("Studio SVG path", () => {
  it("draws a rectangle from M, H, V and Z, with y as v and nothing flipped", () => {
    expect(pathContours("M 0 0 H 20 V 10 H 0 Z")).toEqual([
      [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
    ]);
    // Counter-clockwise with v up, as written.
    expect(area(pathContours("M 0 0 H 20 V 10 H 0 Z"))).toBeCloseTo(200, 9);
  });

  it("takes lower-case commands from the pen", () => {
    expect(pathContours("m 5 5 h 20 v 10 h -20 z")).toEqual([
      [
        [5, 5],
        [25, 5],
        [25, 15],
        [5, 15],
      ],
    ]);
    expect(pathContours("M 10 10 l 10 0 l 0 10 l -10 0 z")).toEqual(pathContours("M 10 10 L 20 10 L 20 20 L 10 20 Z"));
    expect(pathContours("M 10 10 c 0 5 5 10 10 10 l 0 -10 z")).toEqual(
      pathContours("M 10 10 C 10 15 15 20 20 20 L 20 10 Z"),
    );
  });

  it("draws a circle from two arcs, its points on the circle and its area a circle's", () => {
    const loops = pathContours("M -20 0 A 20 20 0 0 1 20 0 A 20 20 0 0 1 -20 0 Z");
    expect(loops).toHaveLength(1);
    const [loop] = loops;
    for (const [u, v] of loop) expect(Math.hypot(u, v)).toBeCloseTo(20, 9);
    // No piece cuts inside the circle by more than the tolerance.
    for (let i = 0; i < loop.length; i++) {
      const [a, b] = [loop[i], loop[(i + 1) % loop.length]];
      expect(Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBeGreaterThanOrEqual(20 - PATH_TOLERANCE);
    }
    expect(Math.abs(area(loops)) / (Math.PI * 400)).toBeGreaterThan(0.995);
    expect(Math.abs(area(loops)) / (Math.PI * 400)).toBeLessThanOrEqual(1);
  });

  it("turns an arc's ellipse by its rotation, and goes the way its sweep flag says", () => {
    const [ellipse] = pathContours("M -40 0 A 40 20 0 0 1 40 0 A 40 20 0 0 1 -40 0 Z");
    expect(Math.abs(signedArea(ellipse)) / (Math.PI * 800)).toBeGreaterThan(0.995);
    const [turned] = pathContours("M 0 -40 A 40 20 90 0 1 0 40 A 40 20 90 0 1 0 -40 Z");
    const vs = turned.map(([, v]) => v);
    const us = turned.map(([u]) => u);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(80, 6);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(40, 1);
    // Sweep 1 turns the angle up, which with v up is counter-clockwise; sweep 0 the other way.
    expect(signedArea(pathContours("M 10 0 A 10 10 0 0 1 -10 0 Z")[0])).toBeGreaterThan(0);
    expect(signedArea(pathContours("M 10 0 A 10 10 0 0 0 -10 0 Z")[0])).toBeLessThan(0);
    // The large-arc flag takes the long way round between the same ends.
    const small = Math.abs(signedArea(pathContours("M 0 0 A 10 10 0 0 1 10 10 Z")[0]));
    const big = Math.abs(signedArea(pathContours("M 0 0 A 10 10 0 1 1 10 10 Z")[0]));
    expect(big).toBeGreaterThan(small * 5);
  });

  it("scales radii up until they reach, and draws a zero-radius arc as a line", () => {
    // Radius 1 can't span 10 mm: it grows to 5, a half circle about (5, 0).
    const [half] = pathContours("M 0 0 A 1 1 0 0 1 10 0 Z");
    for (const [u, v] of half) expect(Math.hypot(u - 5, v)).toBeCloseTo(5, 9);
    expect(Math.abs(signedArea(half)) / ((Math.PI * 25) / 2)).toBeGreaterThan(0.98);
    expect(pathContours("M 0 0 A 0 5 0 0 1 10 0 L 10 10 Z")).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    ]);
    // An arc ending where it starts draws nothing.
    expect(pathContours("M 0 0 A 5 5 0 0 1 0 0 L 10 0 L 10 10 Z")[0]).toHaveLength(3);
  });

  it("gives a donut's two subpaths as two loops, the hole wound against the outside", () => {
    const loops = pathContours(
      "M -30 0 A 30 30 0 0 1 30 0 A 30 30 0 0 1 -30 0 Z M -10 0 A 10 10 0 0 0 10 0 A 10 10 0 0 0 -10 0 Z",
    );
    expect(loops).toHaveLength(2);
    expect(Math.sign(signedArea(loops[0]))).toBe(-Math.sign(signedArea(loops[1])));
    expect(Math.abs(area(loops)) / (Math.PI * (900 - 100))).toBeCloseTo(1, 2);
  });

  it("mirrors the last control point for S and T, and uses the pen after anything else", () => {
    expect(pathContours("M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0 Z")).toEqual(
      pathContours("M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0 Z"),
    );
    expect(pathContours("M 0 0 Q 5 10 10 0 T 20 0 Z")).toEqual(pathContours("M 0 0 Q 5 10 10 0 Q 15 -10 20 0 Z"));
    // A T after a T mirrors the control point it worked out.
    expect(pathContours("M 0 0 Q 5 10 10 0 T 20 0 T 30 0 L 30 -20 Z")).toEqual(
      pathContours("M 0 0 Q 5 10 10 0 Q 15 -10 20 0 Q 25 10 30 0 L 30 -20 Z"),
    );
    expect(pathContours("M 0 0 S 10 10 20 0 Z")).toEqual(pathContours("M 0 0 C 0 0 10 10 20 0 Z"));
    expect(pathContours("M 0 0 L 5 0 S 10 10 20 0 Z")).toEqual(pathContours("M 0 0 L 5 0 C 5 0 10 10 20 0 Z"));
  });

  it("keeps a curve's pieces within the tolerance, more of them the finer it is", () => {
    const control: Vec2[] = [
      [0, 0],
      [0, 40],
      [60, -20],
      [60, 30],
    ];
    const curve = (t: number): Vec2 => {
      const [a, b, c, d] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
      return [
        a * control[0][0] + b * control[1][0] + c * control[2][0] + d * control[3][0],
        a * control[0][1] + b * control[1][1] + c * control[2][1] + d * control[3][1],
      ];
    };
    const d = `M 0 0 C ${control.slice(1).flat().join(" ")} L 60 -40 L 0 -40 Z`;
    for (const tolerance of [0.5, 0.05, 0.01]) {
      const [loop] = pathContours(d, tolerance);
      let worst = 0;
      for (let i = 0; i <= 1000; i++) worst = Math.max(worst, distanceToLoop(curve(i / 1000), loop));
      expect(worst).toBeLessThanOrEqual(tolerance);
    }
    expect(pathContours(d, 0.01)[0].length).toBeGreaterThan(pathContours(d, 0.5)[0].length);
  });

  it("reads numbers written close together, and arc flags with nothing between them", () => {
    expect(pathContours("M0,0L10-5L1.5.5L-2e1,1E1z")).toEqual(pathContours("M 0 0 L 10 -5 L 1.5 0.5 L -20 10 Z"));
    expect(pathContours("M0 0a5 5 0 105 5z")).toEqual(pathContours("M 0 0 a 5 5 0 1 0 5 5 z"));
    expect(pathContours("M0,0 h+10 v.5e1 H0\n\tz")).toEqual(pathContours("M 0 0 H 10 V 5 H 0 Z"));
  });

  it("repeats a command for more numbers, as lines after a move", () => {
    expect(pathContours("M 0 0 10 0 10 10 0 10 z")).toEqual(pathContours("M 0 0 L 10 0 L 10 10 L 0 10 Z"));
    expect(pathContours("m 5 5 10 0 0 10 -10 0 z")).toEqual(pathContours("M 5 5 L 15 5 L 15 15 L 5 15 Z"));
    expect(pathContours("M 0 0 L 10 0 10 10 0 10 Z")).toEqual(pathContours("M 0 0 L 10 0 L 10 10 L 0 10 Z"));
    expect(pathContours("M 0 0 C 0 5 5 10 10 10 15 10 20 5 20 0 Z")).toEqual(
      pathContours("M 0 0 C 0 5 5 10 10 10 C 15 10 20 5 20 0 Z"),
    );
  });

  it("closes a subpath left open, and starts the next one where the last started after a Z", () => {
    const triangle = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(pathContours("M 0 0 L 10 0 L 10 10")).toEqual([triangle]);
    // Back at the start without Z: that last point is the closing edge.
    expect(pathContours("M 0 0 L 10 0 L 10 10 L 0 0")).toEqual([triangle]);
    expect(pathContours("M 0 0 L 10 0 L 10 10 M 20 0 L 30 0 L 30 10")).toHaveLength(2);
    expect(pathContours("M 0 0 L 10 0 L 10 10 Z L -10 0 L -10 -10 Z")).toEqual([
      triangle,
      [
        [0, 0],
        [-10, 0],
        [-10, -10],
      ],
    ]);
    // Relative after Z is from the start, where the pen went back to.
    expect(pathContours("M 5 5 l 10 0 l 0 10 z m 0 -10 l 5 0 l 0 5 z")[1][0]).toEqual([5, -5]);
  });

  it("drops repeated points, and loops with too few points or no area", () => {
    expect(pathContours("M 0 0 L 0 0 L 10 0 L 10 0 L 10 10 Z")).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    ]);
    expect(pathContours("M 0 0 H 10 V 10 Z M 50 50 L 60 50 L 70 50 Z M 80 80 L 90 90 M 1 1")).toHaveLength(1);
    // A line drawn there and back, and a speck a ten-thousandth of a mm across.
    expect(
      pathContours("M 0 0 H 10 V 10 Z M 0 20 L 10 30 L 20 40 L 10 30 Z M 50 0 h 1e-4 v 1e-4 h -1e-4 z"),
    ).toHaveLength(1);
  });

  it("keeps a figure of eight, though its halves cancel out in its signed area", () => {
    const [bowtie] = pathContours("M 0 0 L 10 10 L 10 0 L 0 10 Z");
    expect(bowtie).toHaveLength(4);
    expect(signedArea(bowtie)).toBeCloseTo(0, 9);
  });

  it("says where the data can't be read, and what was wanted there", () => {
    expect(() => pathContours("M 0 0 L 10 q 1")).toThrow(
      `Path data can't be read at "q 1" (character 12): a number was expected (L takes x y).`,
    );
    expect(() => pathContours("M 0 0 L 10")).toThrow(
      `Path data ends too soon, after "M 0 0 L 10": a number was expected (L takes x y).`,
    );
    expect(() => pathContours("L 0 0 10 10")).toThrow(/character 1\): it has to start with a move/);
    expect(() => pathContours("10 10")).toThrow(/has to start with a move/);
    expect(() => pathContours("M 0 0 X 5 5")).toThrow(/at "X 5 5" \(character 7\): a command letter was expected/);
    expect(() => pathContours("M 0 0 L 10 0 L 10 10 Z 5 5")).toThrow(/Z takes no numbers/);
    expect(() => pathContours("M 0 0 A 5 5 0 2 0 10 0")).toThrow(/character 15\): a flag, 0 or 1, was expected/);
    expect(() => pathContours("M 0 0 L 1e999 0 L 0 1 Z")).toThrow(/1e999 is too big/);
    expect(() => pathContours("M 0 0 L 10,,0 L 0 1 Z")).toThrow(/character 12\): a number was expected/);
    expect(() => pathContours("M 0 0 C 1 2 3 4 5")).toThrow(/C takes x1 y1 x2 y2 x y/);
    // Long data is quoted in part.
    expect(() => pathContours(`M 0 0 L 1 1 ? ${"L 2 2 ".repeat(10)}`)).toThrow(/at "\? L 2 2 L 2 2 L…"/);
  });

  it("refuses empty data, data that draws nothing, too much data, and a tolerance that isn't one", () => {
    expect(() => pathContours("")).toThrow(/empty/);
    expect(() => pathContours("  \n ")).toThrow(/empty/);
    expect(() => pathContours("M 0 0 L 10 0 Z")).toThrow(/draws no area/);
    expect(() => pathContours(`M 0 0${" L 1 1".repeat(5000)}`)).toThrow(/30,005 characters long, over the 20,000/);
    // A short path whose curves come to too many points: each near-full turn is cut into the most pieces a curve gets.
    expect(() => pathContours(`M 0 0${" a 1000 1000 0 1 1 0 1 a 1000 1000 0 1 1 0 -1".repeat(50)}`)).toThrow(
      /more than 20,000 points/,
    );
    expect(() => pathContours("M 0 0 H 10 V 10 Z", 0)).toThrow(/tolerance/);
    expect(() => pathContours("M 0 0 H 10 V 10 Z", Number.NaN)).toThrow(/tolerance/);
  });
});
