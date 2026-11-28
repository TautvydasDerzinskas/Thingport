import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStudioThreeMf } from "../src/services/modelPreviewRender";
import { writeStudioThreeMf } from "../src/services/studioThreeMf";
import type { EvaluatedBody } from "../src/studio/geometry.generated";

// Bodies that touch are one object in a Studio 3MF, a part each, as slicers keep a multi-colour model: as separate
// objects an inlay and what it sits in print into each other. Opened in Studio again, they're those bodies.

const BED = 256;
const THUMBNAIL = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-studio-3mf-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A box standing on the bed between two corners given in bed coordinates; Studio's world is centred on the bed. */
function box(id: string, [x0, y0]: [number, number], [x1, y1]: [number, number], height = 10): EvaluatedBody {
  const [minX, minY, maxX, maxY] = [x0 - BED / 2, y0 - BED / 2, x1 - BED / 2, y1 - BED / 2];
  const positions = new Float32Array(
    [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [i & 1 ? maxX : minX, i & 2 ? maxY : minY, i & 4 ? height : 0]),
  );
  // prettier-ignore
  const indices = new Uint32Array([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]);
  return {
    id,
    mesh: { positions, indices },
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    bounds: { min: [minX, minY, 0], max: [maxX, maxY, height] },
    volume: (maxX - minX) * (maxY - minY) * height,
    triangles: 12,
  };
}

const part = (body: EvaluatedBody, color: string) => ({ body, name: body.id, plateId: "plate-1", color });

async function written(parts: ReturnType<typeof part>[]) {
  const bytes = await writeStudioThreeMf("Test", parts, [{ id: "plate-1", name: "Plate", thumbnail: THUMBNAIL }]);
  const zip = await JSZip.loadAsync(bytes!);
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.3mf`);
  await fs.writeFile(file, bytes!);
  return {
    file,
    model: await zip.file("3D/3dmodel.model")!.async("string"),
    settings: await zip.file("Metadata/model_settings.config")!.async("string"),
  };
}

function extent(triangles: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i++) {
    min[i % 3] = Math.min(min[i % 3], triangles[i]);
    max[i % 3] = Math.max(max[i % 3], triangles[i]);
  }
  return { min, max };
}

describe("Studio's 3MF objects", () => {
  it("writes bodies that touch as one object, a part each in its own filament, and reads them back as those bodies", async () => {
    const coin = box("Coin", [100, 100], [140, 140], 2);
    const logo = box("Logo", [110, 110], [130, 130], 2);
    const token = box("Token", [20, 20], [40, 40], 2);
    const { file, model, settings } = await written([
      part(coin, "#ff0000"),
      part(logo, "#00ff00"),
      part(token, "#ff0000"),
    ]);

    expect(model.match(/<item /g)).toHaveLength(2);
    const [first] = model.match(/<object id="\d+"[^>]*><components>[\s\S]*?<\/components>/g)!;
    expect(first.match(/<component /g)).toHaveLength(2);
    const [coinObject] = settings.match(/<object id="\d+">[\s\S]*?<\/object>/g)!;
    expect(coinObject).toMatch(
      /^<object id="\d+"><metadata key="name" value="Coin"\/><metadata key="extruder" value="1"\/>/,
    );
    expect(
      [
        ...coinObject.matchAll(
          /<part [^>]*><metadata key="name" value="([^"]*)"\/><metadata key="extruder" value="(\d+)"/g,
        ),
      ].map((m) => [m[1], m[2]]),
    ).toEqual([
      ["Coin", "1"],
      ["Logo", "2"],
    ]);

    // Opened in Studio again, each part is its own body, in its colour and where it was.
    const project = await loadStudioThreeMf(file, 10_000, 10);
    if (typeof project === "string") throw new Error(project);
    expect(project.mixedColors).toBe(false);
    const bodies = project.plates[0].parts;
    expect(bodies.map(({ name, color }) => [name, color?.toLowerCase()])).toEqual([
      ["Coin", "#ff0000"],
      ["Logo", "#00ff00"],
      ["Token", "#ff0000"],
    ]);
    for (const [body, source] of [
      [bodies[0], coin],
      [bodies[1], logo],
      [bodies[2], token],
    ] as const) {
      const { min, max } = extent(body.triangles);
      for (let axis = 0; axis < 3; axis++) {
        expect(min[axis]).toBeCloseTo(source.bounds.min[axis], 3);
        expect(max[axis]).toBeCloseTo(source.bounds.max[axis], 3);
      }
    }
  });

  it("brings touching bodies of one colour back as the bodies they were", async () => {
    const base = box("Base", [100, 100], [140, 140], 2);
    const knob = box("Knob", [115, 115], [125, 125], 4);
    const { file, model } = await written([part(base, "#ff0000"), part(knob, "#ff0000")]);
    expect(model.match(/<item /g)).toHaveLength(1);
    const project = await loadStudioThreeMf(file, 10_000, 10);
    if (typeof project === "string") throw new Error(project);
    expect(project.plates[0].parts.map(({ name }) => name)).toEqual(["Base", "Knob"]);
  });

  it("tells apart parts whose meshes have the same id in different part files", async () => {
    const mesh = (x: number) => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources><object id="1" type="model"><mesh>
 <vertices><vertex x="${x}" y="0" z="0"/><vertex x="${x + 10}" y="0" z="0"/><vertex x="${x}" y="10" z="0"/><vertex x="${x}" y="0" z="10"/></vertices>
 <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles>
</mesh></object></resources><build/></model>`;
    const zip = new JSZip();
    zip.file("3D/Objects/left.model", mesh(0));
    zip.file("3D/Objects/right.model", mesh(20));
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit="millimeter" requiredextensions="p">
 <resources><object id="2" type="model"><components>
  <component p:path="/3D/Objects/left.model" objectid="1"/><component p:path="/3D/Objects/right.model" objectid="1"/>
 </components></object></resources>
 <build><item objectid="2"/></build>
</model>`,
    );
    zip.file(
      "Metadata/model_settings.config",
      `<config><object id="2"><metadata key="name" value="Pair"/><metadata key="extruder" value="1"/>
<part id="1" subtype="normal_part"><metadata key="name" value="Left"/><metadata key="extruder" value="1"/></part>
<part id="1" subtype="normal_part"><metadata key="name" value="Right"/><metadata key="extruder" value="2"/></part>
</object></config>`,
    );
    zip.file("Metadata/project_settings.config", JSON.stringify({ filament_colour: ["#FF0000", "#0000FF"] }));
    const file = path.join(dir, "same-ids.3mf");
    await fs.writeFile(file, await zip.generateAsync({ type: "uint8array" }));

    const project = await loadStudioThreeMf(file, 10, 10);
    if (typeof project === "string") throw new Error(project);
    expect(project.plates[0].parts.map(({ name, color }) => [name, color?.toLowerCase()])).toEqual([
      ["Left", "#ff0000"],
      ["Right", "#0000ff"],
    ]);
  });

  it("keeps an object whose faces are painted in several colours as one body", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="10" y="10" z="0"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2" paint_color="4"/><triangle v1="1" v2="3" v3="2" paint_color="8"/></triangles>
  </mesh></object>
  <object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
 </resources>
 <build><item objectid="2"/></build>
</model>`;
    const zip = new JSZip();
    zip.file("3D/3dmodel.model", xml);
    zip.file("Metadata/project_settings.config", JSON.stringify({ filament_colour: ["#FF0000", "#0000FF"] }));
    const file = path.join(dir, "painted.3mf");
    await fs.writeFile(file, await zip.generateAsync({ type: "uint8array" }));

    const project = await loadStudioThreeMf(file, 10, 10);
    if (typeof project === "string") throw new Error(project);
    expect(project.mixedColors).toBe(true);
    expect(project.plates[0].parts).toHaveLength(1);
  });
});
