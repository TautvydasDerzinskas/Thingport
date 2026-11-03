import { describe, expect, it } from "vitest";
import Module from "manifold-3d";
import { addTrace, applyCommand, CommandError, traceTarget } from "./commands";
import { emptyDocument, featureById } from "./document";
import { evaluateDesign } from "./geometry";
import { signedArea } from "./shapes2d";
import { bright, findThreshold, traceContours, tracePicture, TRACE_POINTS, type Brightness } from "./trace";

// Tracing a picture's shapes into a sketch: rings stay rings, what's in their holes stays solid, and the outline comes
// out at the size asked for.

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

/** A white picture with black wherever `ink` says. */
function picture(size: number, ink: (x: number, y: number) => boolean): Brightness {
  const data = new Uint8Array(size * size).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (ink(x + 0.5, y + 0.5)) data[y * size + x] = 0;
  return { width: size, height: size, data };
}

const distance = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy);
// A ring with a dot in its hole, as a target is.
const target = picture(200, (x, y) => {
  const r = distance(x, y, 100, 100);
  return (r > 60 && r < 90) || r < 25;
});

describe("Studio trace", () => {
  it("keeps a ring's hole and the dot inside it, each wound the right way", () => {
    const traced = tracePicture(target, { threshold: null, invert: false, detail: "medium" });
    expect(traced.loops).toBe(3);
    expect(traced.holes).toBe(1);
    expect(traced.aspect).toBeCloseTo(1, 1);
    const loops = traceContours({
      type: "trace",
      picture_id: "",
      center: [0, 0],
      width: 180,
      height: 180,
      threshold: null,
      invert: false,
      detail: "medium",
      outline: traced.outline,
    });
    const byArea = loops.toSorted((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    const signs = byArea.map((loop) => Math.sign(signedArea(loop)));
    // The outside, the hole, the dot: the hole against the other two.
    expect(signs[0]).toBe(signs[2]);
    expect(signs[1]).toBe(-signs[0]);
    // In mm: the outer edge is 180 mm across, as asked.
    const xs = byArea[0].map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(180, 0);
  });

  it("keeps two squares that touch only at a corner apart", () => {
    const corners = picture(40, (x, y) => (x < 20 && y < 20) || (x >= 20 && y >= 20));
    expect(tracePicture(corners, { threshold: 128, invert: false, detail: "high" }).loops).toBe(2);
  });

  it("finds a threshold between ink and paper, and says when there's nothing to trace", () => {
    const grey = picture(50, (x) => x < 25);
    for (let i = 0; i < grey.data.length; i++) grey.data[i] = grey.data[i] ? 220 : 40;
    const found = findThreshold(grey);
    expect(found).toBeGreaterThan(40);
    expect(found).toBeLessThanOrEqual(220);
    expect(() =>
      tracePicture(
        picture(20, () => false),
        { threshold: null, invert: false, detail: "medium" },
      ),
    ).toThrow(/there's no shape to trace/);
  });

  it("traces light on dark when inverted, and counts see-through as paper", () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    // A see-through picture with one opaque white pixel and one opaque black one.
    rgba.set([255, 255, 255, 255], 0);
    rgba.set([0, 0, 0, 255], 4);
    const gray = bright(rgba, 4, 4);
    expect(gray.data[0]).toBe(255);
    expect(gray.data[1]).toBe(0);
    expect(gray.data[2]).toBe(255);
    const inverted = tracePicture(target, { threshold: 128, invert: true, detail: "medium" });
    // Inverted, the paper is the shape: the paper round the ring and the gap inside it, each with its hole.
    expect(inverted.loops).toBe(4);
    expect(inverted.holes).toBe(2);
  });

  it("keeps a detailed picture to its points by smoothing it more", () => {
    // 900 dots, each a dozen points or so as drawn, too many to keep that finely.
    const dots = picture(300, (x, y) => distance(x % 10, y % 10, 5, 5) < 4);
    const traced = tracePicture(dots, { threshold: 128, invert: false, detail: "high" });
    expect(traced.points).toBeLessThanOrEqual(TRACE_POINTS);
    expect(traced.loops).toBe(900);
    // Far more than a trace keeps, even at its plainest.
    const tiles = picture(600, (x, y) => (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0);
    expect(() => tracePicture(tiles, { threshold: 128, invert: false, detail: "low" })).toThrow(/too much detail/);
  });

  it("makes the traced outline solid, at the size asked, holes and all", async () => {
    const traced = tracePicture(target, { threshold: null, invert: false, detail: "medium" });
    const outcome = addTrace(
      emptyDocument(),
      { picture_id: "a".repeat(24), width: 90, plane: "XY", height: 2 },
      traced,
    );
    expect(outcome.summary).toMatch(/^Traced the picture into sketch-1: 3 shapes \(1 of them holes\), 90 × 90 mm/);
    expect(outcome.created).toEqual(["sketch-1", "extrude-2"]);
    const made = evaluateDesign(await wasm, outcome.document);
    expect(made.errors).toEqual([]);
    const body = made.bodies[0];
    expect(body.bounds.max[0] - body.bounds.min[0]).toBeCloseTo(90, 0);
    // The ring and the dot, at 90/180 of the picture's pixels: π(45² - 30² + 12.5²) × 2 mm high.
    const expected = Math.PI * (45 ** 2 - 30 ** 2 + 12.5 ** 2) * 2;
    expect(body.volume).toBeGreaterThan(expected * 0.95);
    expect(body.volume).toBeLessThan(expected * 1.05);
  });

  it("traces again into the shape it replaces, and refuses what isn't a traced shape", () => {
    const traced = tracePicture(target, { threshold: null, invert: false, detail: "medium" });
    const first = addTrace(emptyDocument(), { picture_id: "a".repeat(24), width: 50, plane: "XY" }, traced);
    const again = addTrace(
      first.document,
      { picture_id: "a".repeat(24), width: 20, sketch_id: "sketch-1", index: 0, detail: "low" },
      traced,
    );
    const sketch = featureById(again.document, "sketch-1");
    expect(sketch?.type === "sketch" && sketch.shapes).toMatchObject([{ type: "trace", width: 20, detail: "low" }]);
    const boxed = applyCommand(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "circle", center: [0, 0], radius: 5 }],
    }).document;
    expect(() => traceTarget(boxed, { sketch_id: "sketch-1", index: 0 })).toThrow(CommandError);
    expect(() => traceTarget(boxed, {})).toThrow(/Give a plane or a face/);
  });
});
