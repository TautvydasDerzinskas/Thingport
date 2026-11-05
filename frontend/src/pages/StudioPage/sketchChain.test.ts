import { describe, expect, it } from "vitest";
import { pathContours } from "../../studio/svgPath";
import { arcPoints, chainShape } from "./sketchChain";

// The Line and Arc tools' chain, closed into the shape a sketch keeps.

const area = (loop: [number, number][]) =>
  Math.abs(
    loop.reduce((sum, [x, y], i) => sum + x * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * y, 0) /
      2,
  );

describe("Studio's sketch chain", () => {
  it("closes straight pieces into a polygon whose corners stay editable", () => {
    expect(chainShape([0, 0], [{ to: [10, 0] }, { to: [10, 5] }, { to: [0, 0] }])).toEqual({
      type: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [10, 5],
      ],
    });
    // Closed by Enter: back to the start in a straight line.
    expect(chainShape([0, 0], [{ to: [10, 0] }, { to: [10, 5] }])).toMatchObject({ type: "polygon" });
    expect(chainShape([0, 0], [{ to: [10, 0] }])).toBeNull();
  });

  it("makes arcs a path, the way round that passes the point clicked", () => {
    // A half disc: along the bottom, then over the top back to the start.
    const dome = chainShape([0, 0], [{ to: [20, 0] }, { to: [0, 0], through: [10, 10] }]);
    expect(dome).toEqual({ type: "path", d: "M 0 0 L 20 0 A 10 10 0 0 1 0 0 Z" });
    const [loop] = pathContours((dome as { d: string }).d);
    // Drawn as short straight steps, a hair under the true half disc.
    expect(area(loop) / ((Math.PI * 100) / 2)).toBeGreaterThan(0.99);
    expect(Math.max(...loop.map(([, v]) => v))).toBeCloseTo(10, 1);
    // Through a point below, it bulges down instead, and the long way round where the point says so.
    const [down] = pathContours(
      (chainShape([0, 0], [{ to: [20, 0] }, { to: [0, 0], through: [10, -10] }]) as { d: string }).d,
    );
    expect(Math.min(...down.map(([, v]) => v))).toBeCloseTo(-10, 1);
    const long = chainShape([0, 0], [{ to: [10, 0], through: [5, 8] }, { to: [5, -5] }]) as { d: string };
    expect(long.d).toMatch(/^M 0 0 A 5\.563 5\.563 0 1 0 10 0 L 5 -5 Z$/);
  });

  it("draws an arc to its end, through its middle point", () => {
    const points = arcPoints([0, 0], [10, 10], [20, 0]);
    expect(points[points.length - 1]).toEqual([20, 0]);
    expect(points.some(([u, v]) => Math.hypot(u - 10, v - 10) < 0.5)).toBe(true);
    expect(arcPoints([0, 0], [5, 0], [10, 0])).toEqual([[10, 0]]);
  });
});
