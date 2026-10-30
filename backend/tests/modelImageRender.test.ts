import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderModelImage } from "../src/services/modelImageRender";

let dir: string;

// An ASCII STL box, `w` x `d` x `h`, Z-up as print files are.
function boxStl(w: number, d: number, h: number): string {
  const v = (x: number, y: number, z: number) => `vertex ${x * w} ${y * d} ${z * h}`;
  const faces: [number, number, number][][] = [
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    [
      [0, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [1, 0, 0],
      [1, 1, 1],
      [1, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 1],
    ],
  ];
  const facets = faces.map(
    (f) => `facet normal 0 0 0\nouter loop\n${f.map((p) => v(...p)).join("\n")}\nendloop\nendfacet`,
  );
  return `solid box\n${facets.join("\n")}\nendsolid box\n`;
}

async function render(name: string, stl: string) {
  const src = path.join(dir, `${name}.stl`);
  const dest = path.join(dir, `${name}.png`);
  await fs.writeFile(src, stl);
  expect(await renderModelImage(src, dest, ".stl", { size: 64, color: "#00b800" })).toEqual({
    status: "ok",
    colored: false,
  });
  const { data, info } = await sharp(dest).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-model-image-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("model pictures", () => {
  it("draws the model in the given colour on a transparent background", async () => {
    const { data, info } = await render("cube", boxStl(20, 20, 20));
    expect([info.width, info.height, info.channels]).toEqual([64, 64, 4]);
    const corner = data.subarray(0, 4);
    expect(corner[3]).toBe(0);
    const middle = data.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4);
    expect(middle[3]).toBe(255);
    // Shaded, but always the accent's hue: green dominant, no red.
    expect(middle[1]).toBeGreaterThan(middle[0]);
    expect(middle[1]).toBeGreaterThan(middle[2]);
  });

  it("looks at a flat model from above as well, so it isn't a thin line", async () => {
    const coverage = async (name: string, stl: string) => {
      const { data } = await render(name, stl);
      let covered = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) covered++;
      return covered / (data.length / 4);
    };
    // Seen straight from the front, a 1 mm high plate would cover almost nothing.
    expect(await coverage("plate", boxStl(60, 60, 1))).toBeGreaterThan(0.2);
  });

  it("draws a STEP file, which the CAD kernel has to tessellate first", async () => {
    const dest = path.join(dir, "box-step.png");
    expect(
      await renderModelImage(path.join(__dirname, "fixtures", "box.step"), dest, ".step", {
        size: 64,
        color: "#00b800",
      }),
    ).toEqual({ status: "ok", colored: false });
    const { data } = await sharp(dest).raw().toBuffer({ resolveWithObject: true });
    let covered = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) covered++;
    // A 20 mm cube seen straight on fills most of the frame.
    expect(covered / (data.length / 4)).toBeGreaterThan(0.5);
  });

  it("refuses a format it can't read", async () => {
    const src = path.join(dir, "x.lbrn");
    await fs.writeFile(src, "<LightBurnProject/>");
    expect(await renderModelImage(src, path.join(dir, "x.png"), ".lbrn", { size: 64, color: "#00b800" })).toBe(
      "unsupported",
    );
  });
});
