import { beforeAll, describe, expect, it } from "vitest";
import Module from "manifold-3d";
import { parse } from "opentype.js";
import { applyCommand, CommandError } from "./commands";
import { emptyDocument, featureById, sketchFrame, type StudioDocument } from "./document";
import { evaluateDesign } from "./geometry";
import { signedArea } from "./shapes2d";
import { addFont, DEFAULT_FONT, fontsIn, STUDIO_FONTS, textContours } from "./text";
import { TOOL_FONTS } from "../sdk/fonts";

// Text in a sketch: letters laid out in Thingport's own fonts, their holes kept, and made solid like any other shape.

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

beforeAll(async () => {
  // Node's own module, which the browser-typed frontend has no types for.
  const fsModule = "node:fs";
  const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: URL): Uint8Array };
  for (const font of STUDIO_FONTS) {
    const bytes = readFileSync(new URL(`../assets/toolFonts/${font.id}.ttf`, import.meta.url));
    addFont(
      font.id,
      parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) as never,
    );
  }
});

const bounds = (contours: [number, number][][]) => {
  const points = contours.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe("Studio text", () => {
  it("offers the fonts tools have, by the same ids and names", () => {
    expect(STUDIO_FONTS.map(({ id, name }) => ({ id, name }))).toEqual(
      TOOL_FONTS.map(({ id, name }) => ({ id, name })),
    );
  });

  it("draws a letter's counter wound against its outside, at the size of a capital", () => {
    const contours = textContours({ type: "text", text: "O", size: 10, center: [0, 0] });
    expect(contours).toHaveLength(2);
    const [outer, inner] = contours.toSorted((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    expect(Math.sign(signedArea(outer))).toBe(-Math.sign(signedArea(inner)));
    const box = bounds(contours);
    // A round capital overshoots its cap height a little, above and below.
    expect(box.maxY - box.minY).toBeGreaterThan(9.8);
    expect(box.maxY - box.minY).toBeLessThan(10.6);
    // Centred on its middle.
    expect(Math.abs(box.maxX + box.minX)).toBeLessThan(0.5);
    expect(Math.abs(box.maxY + box.minY)).toBeLessThan(0.5);
  });

  it("lays out lines under each other, lined up as asked", () => {
    const left = textContours({ type: "text", text: "WIDE\nI", size: 5, center: [0, 0], align: "left" });
    const right = textContours({ type: "text", text: "WIDE\nI", size: 5, center: [0, 0], align: "right" });
    const lowest = (contours: [number, number][][]) =>
      contours.filter((contour) => Math.max(...contour.map(([, y]) => y)) < -1);
    expect(bounds(lowest(left)).minX).toBeLessThan(bounds(lowest(right)).minX - 5);
  });

  it("refuses a letter the font hasn't got, and names the fonts that have it", () => {
    expect(() => textContours({ type: "text", text: "Ąžuolas", size: 8, center: [0, 0], font: "arvo" })).toThrow(
      /Arvo has no letter for “Ą”.*PT Sans/,
    );
    const doc = emptyDocument();
    expect(() =>
      applyCommand(doc, "add_text", { text: "Ąžuolas", size: 8, height: 2, plane: "XY", font: "arvo" }),
    ).toThrow(CommandError);
  });

  it("finds the fonts a design's text and a command's arguments use", () => {
    expect(
      fontsIn({
        shapes: [
          { type: "text", text: "a", font: "anton" },
          { type: "text", text: "b" },
        ],
      }),
    ).toEqual(["anton", DEFAULT_FONT]);
    expect(fontsIn({ text: "a", font: "lobster", size: 5, height: 1 })).toEqual(["lobster"]);
  });

  it("makes raised letters a closed solid, holes and all", async () => {
    const doc = applyCommand(emptyDocument(), "add_text", { text: "Hello\nAa8", size: 10, height: 2, plane: "XY" });
    expect(doc.created).toHaveLength(2);
    const made = evaluateDesign(await wasm, doc.document);
    expect(made.errors).toEqual([]);
    const body = made.bodies[0];
    expect(body.bounds.min[2]).toBeCloseTo(0);
    expect(body.bounds.max[2]).toBeCloseTo(2);
    // The counters of e, o, A, a and 8 are open: with them filled, the letters would hold far more.
    const filled = textContours({ type: "text", text: "Hello\nAa8", size: 10, center: [0, 0] })
      .map((contour) => Math.abs(signedArea(contour)))
      .reduce((sum, area) => sum + area, 0);
    expect(body.volume).toBeLessThan(filled * 2 * 0.9);
    expect(body.volume).toBeGreaterThan(0);
  });

  it("writes upright on a wall that faces away, as on one that faces the front", () => {
    const doc: StudioDocument = applyCommand(emptyDocument(), "add_box", { width: 40, depth: 20, height: 20 }).document;
    for (const normal of [
      [0, 1, 0],
      [-1, 0, 0],
      [0, -1, 0],
    ] as const) {
      const outcome = applyCommand(doc, "add_text", {
        text: "A",
        size: 5,
        height: 1,
        face: { point: [0, 0, 10], normal: [...normal] },
        target_id: "box-1",
      });
      const sketch = featureById(outcome.document, outcome.created[0]);
      if (sketch?.type !== "sketch") throw new Error("no sketch");
      // Up the letter is up the world.
      sketchFrame(sketch).v.forEach((value, i) => expect(value).toBeCloseTo([0, 0, 1][i]));
    }
  });

  it("engraves into a face: cut, and as deep as asked", async () => {
    const box = applyCommand(emptyDocument(), "add_box", { width: 60, depth: 20, height: 10 }).document;
    const outcome = applyCommand(box, "add_text", {
      text: "TP",
      size: 8,
      height: 1,
      face: { point: [0, 0, 10], normal: [0, 0, 1] },
      target_id: "box-1",
      operation: "cut",
    });
    expect(outcome.summary).toMatch(/^Engraved “TP” in PT Sans, letters 8 mm tall and 1 mm deep/);
    const made = evaluateDesign(await wasm, outcome.document);
    expect(made.errors).toEqual([]);
    expect(made.bodies).toHaveLength(1);
    expect(made.bodies[0].bounds.max[2]).toBeCloseTo(10);
    expect(made.bodies[0].volume).toBeLessThan(60 * 20 * 10 - 10);
  });
});
