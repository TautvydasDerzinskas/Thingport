import { describe, expect, it } from "vitest";
import { angleBetween, areaOf, closestBetween, type Measurable, type Triangle } from "./measure";
import type { Vec3 } from "./vec";

// A box's faces as a pick gives them: two triangles each, in the world.
const square = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Triangle[] => [
  [a, b, c],
  [a, c, d],
];
const face = (triangles: Triangle[], normal: Vec3): Measurable => ({ kind: "face", triangles, normal });
// A 20 × 10 × 6 box from the origin.
const bottom = face(square([0, 0, 0], [0, 10, 0], [20, 10, 0], [20, 0, 0]), [0, 0, -1]);
const top = face(square([0, 0, 6], [20, 0, 6], [20, 10, 6], [0, 10, 6]), [0, 0, 1]);
const side = face(square([0, 0, 0], [20, 0, 0], [20, 0, 6], [0, 0, 6]), [0, -1, 0]);

describe("Studio's measure", () => {
  it("finds the distance between points, edges and faces, and where it runs", () => {
    const point = (at: Vec3): Measurable => ({ kind: "point", point: at });
    expect(closestBetween(point([0, 0, 0]), point([3, 4, 0])).distance).toBeCloseTo(5);
    // A point over a face: straight down onto it.
    const over = closestBetween(point([5, 5, 10]), top);
    expect(over.distance).toBeCloseTo(4);
    expect(over.to).toEqual([5, 5, 6]);
    // Skew edges: square to both, 7 apart.
    const edge = (a: Vec3, b: Vec3): Measurable => ({ kind: "edge", a, b });
    const skew = closestBetween(edge([-5, 0, 0], [5, 0, 0]), edge([0, -5, 7], [0, 5, 7]));
    expect(skew.distance).toBeCloseTo(7);
    expect(skew.from.map((x) => x + 0)).toEqual([0, 0, 0]);
    // A box's height, between its top and bottom; adjacent faces touch.
    expect(closestBetween(bottom, top).distance).toBeCloseTo(6);
    expect(closestBetween(bottom, side).distance).toBe(0);
    // An edge through a face meets it.
    expect(closestBetween(edge([5, 5, -3], [5, 5, 3]), bottom)).toMatchObject({ distance: 0, from: [5, 5, 0] });
  });

  it("gives the angle between edges and faces, and a face's area", () => {
    expect(angleBetween(bottom, top)).toBeCloseTo(0);
    expect(angleBetween(bottom, side)).toBeCloseTo(90);
    const slope: Measurable = { kind: "edge", a: [0, 0, 0], b: [10, 0, 10] };
    expect(angleBetween(slope, bottom)).toBeCloseTo(45);
    expect(angleBetween(slope, { kind: "edge", a: [0, 0, 0], b: [0, 0, 5] })).toBeCloseTo(45);
    expect(angleBetween(slope, { kind: "point", point: [0, 0, 0] })).toBeNull();
    expect(areaOf((top as Extract<Measurable, { kind: "face" }>).triangles)).toBeCloseTo(200);
  });
});
