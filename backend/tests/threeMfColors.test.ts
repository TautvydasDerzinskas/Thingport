import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeZip } from "../src/utils/zipWriter";
import { readColor, readColorGroups, sharePalette } from "../src/services/threeMfColors";
import { loadThreeMfGroup } from "../src/services/modelPreviewRender";

// Two triangles, two colours, written the way frontend/src/sdk/threeMf.ts writes a generated model: a colour
// group the object points at, each triangle naming its own entry, and the same assignment again as the painting
// Bambu Studio and PrusaSlicer read.
const COLOURED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" unit="millimeter">
 <resources>
  <m:colorgroup id="1"><m:color color="#FF0000FF"/><m:color color="#0000FFFF"/></m:colorgroup>
  <object id="2" type="model" pid="1" pindex="0"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="10" y="10" z="0"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2" p1="0" paint_color="4"/><triangle v1="1" v2="3" v3="2" p1="1" paint_color="8"/></triangles>
  </mesh></object>
 </resources>
 <build><item objectid="2"/></build>
</model>`;

// The same two faces painted rather than indexed, and the mesh placed through a component, as a sliced Bambu
// project does it. The wrapper's own filament must not overwrite what the faces say.
const PAINTED_XML = `<?xml version="1.0" encoding="UTF-8"?>
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

const PROJECT_SETTINGS = JSON.stringify({ filament_colour: ["#FF0000FF", "#0000FFFF"] });

// Faces indexed into a colour group, in a project that also lists filaments of its own. The two are different
// palettes, and these faces name the group's entries.
const INDEXED_IN_PROJECT_XML = COLOURED_XML.replace(
  '<m:colorgroup id="1"><m:color color="#FF0000FF"/><m:color color="#0000FFFF"/></m:colorgroup>',
  '<m:colorgroup id="1"><m:color color="#00FF00FF"/><m:color color="#FFFF00FF"/></m:colorgroup>',
).replace(/ paint_color="[^"]*"/g, "");

// A part file with colours of its own, placed by a main model that has a colour group too. Both number their
// resources from 1, so reading one against the other colours the part by whatever shared an id.
const PART_HOST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit="millimeter">
 <resources>
  <m:colorgroup id="1"><m:color color="#FF0000FF"/><m:color color="#0000FFFF"/></m:colorgroup>
  <object id="2" type="model"><components><component p:path="/3D/Objects/part.model" objectid="1"/></components></object>
 </resources>
 <build><item objectid="2"/></build>
</model>`;

const PART_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" unit="millimeter">
 <resources>
  <m:colorgroup id="1"><m:color color="#00FF00FF"/><m:color color="#FFFF00FF"/></m:colorgroup>
  <object id="1" type="model" pid="1" pindex="0"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="10" y="10" z="0"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2" p1="0"/><triangle v1="1" v2="3" v3="2" p1="1"/></triangles>
  </mesh></object>
 </resources>
</model>`;

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-colors-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A .3mf holding this model XML, and a project config where one is given. */
async function threeMf(name: string, xml: string, settings?: string): Promise<string> {
  const modelPath = path.join(dir, `${name}.model`);
  await fs.writeFile(modelPath, xml);
  const entries = [{ arcname: "3D/3dmodel.model", filePath: modelPath }];
  if (settings) {
    const settingsPath = path.join(dir, `${name}.config`);
    await fs.writeFile(settingsPath, settings);
    entries.push({ arcname: "Metadata/project_settings.config", filePath: settingsPath });
  }
  const file = path.join(dir, `${name}.3mf`);
  await writeZip(file, entries);
  return file;
}

/** Every mesh's colour and triangle count, so a split is visible. */
function meshColors(group: import("three").Object3D): { color: string; triangles: number }[] {
  const found: { color: string; triangles: number }[] = [];
  group.traverse((node) => {
    const mesh = node as import("three").Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as import("three").MeshStandardMaterial;
    found.push({ color: material.color.getHexString(), triangles: (mesh.geometry.getIndex()?.count ?? 0) / 3 });
  });
  return found.toSorted((a, b) => a.color.localeCompare(b.color));
}

/** A .3mf whose main model places a mesh held in a part file of its own. */
async function threeMfWithPart(name: string, mainXml: string, partXml: string): Promise<string> {
  const mainPath = path.join(dir, `${name}-main.model`);
  const partPath = path.join(dir, `${name}-part.model`);
  await fs.writeFile(mainPath, mainXml);
  await fs.writeFile(partPath, partXml);
  const file = path.join(dir, `${name}.3mf`);
  await writeZip(file, [
    { arcname: "3D/3dmodel.model", filePath: mainPath },
    { arcname: "3D/Objects/part.model", filePath: partPath },
  ]);
  return file;
}

describe("readColor", () => {
  it("drops the alpha Bambu Studio writes on a filament colour", () => {
    // three.js reads only the six-digit spelling; left as it is, every such filament falls back to white.
    expect(readColor("#FF0000FF")).toBe("#ff0000");
    expect(readColor("#00AE42")).toBe("#00ae42");
    expect(readColor("not a colour")).toBeNull();
  });
});

describe("readColorGroups", () => {
  it("reads the Materials extension's colour group, which is what slicers look for", () => {
    const colors = readColorGroups(COLOURED_XML)!;
    expect(colors.colors).toEqual(["#ff0000", "#0000ff"]);
    expect(colors.slotOf("1", 0)).toBe(0);
    expect(colors.slotOf("1", 1)).toBe(1);
  });

  it("reads the core spec's base materials too, which older files and other tools write", () => {
    const xml = COLOURED_XML.replace(
      /<m:colorgroup id="1">.*?<\/m:colorgroup>/s,
      '<basematerials id="1"><base name="a" displaycolor="#FF0000FF"/><base name="b" displaycolor="#0000FFFF"/></basematerials>',
    );
    expect(readColorGroups(xml)!.colors).toEqual(["#ff0000", "#0000ff"]);
  });

  it("says a file carries no colours rather than handing back an empty palette", () => {
    expect(readColorGroups("<model><resources><object id='1'/></resources></model>")).toBeNull();
  });

  it("names no colour for a group or index the file hasn't got", () => {
    const colors = readColorGroups(COLOURED_XML)!;
    expect(colors.slotOf("1", 9)).toBeNull();
    expect(colors.slotOf("7", 0)).toBeNull();
    expect(colors.slotOf(null, 0)).toBeNull();
  });
});

describe("sharePalette", () => {
  it("gives each file's colours their own stretch, so a slot means one colour model-wide", () => {
    const palette = ["#ff0000", "#0000ff"];
    const shared = sharePalette(palette, readColorGroups(COLOURED_XML))!;
    expect(palette).toEqual(["#ff0000", "#0000ff", "#ff0000", "#0000ff"]);
    expect(shared.colors).toBe(palette);
    expect(shared.slotOf("1", 0)).toBe(2);
    expect(shared.slotOf("1", 1)).toBe(3);
    expect(shared.slotOf("1", 9)).toBeNull();
  });

  it("leaves the palette alone for a file that declares no colours", () => {
    const palette = ["#ff0000"];
    expect(sharePalette(palette, null)).toBeNull();
    expect(palette).toEqual(["#ff0000"]);
  });
});

describe("a coloured 3MF as a preview", () => {
  it("splits a mesh by the colour its faces point at", async () => {
    const group = await loadThreeMfGroup(await threeMf("indexed", COLOURED_XML));
    expect(typeof group).not.toBe("string");
    expect(meshColors(group as import("three").Object3D)).toEqual([
      { color: "0000ff", triangles: 1 },
      { color: "ff0000", triangles: 1 },
    ]);
  });

  it("keeps a painted mesh's filaments through the component that places it", async () => {
    // The wrapper object gives its component a filament; faces that named their own must keep it, or a whole
    // painted project comes back in one colour.
    const group = await loadThreeMfGroup(await threeMf("painted", PAINTED_XML, PROJECT_SETTINGS));
    expect(meshColors(group as import("three").Object3D)).toEqual([
      { color: "0000ff", triangles: 1 },
      { color: "ff0000", triangles: 1 },
    ]);
  });

  it("reads a file's own colour group even where a slicer listed filaments beside it", async () => {
    // The two are different palettes: a painted triangle names a filament, an indexed one an entry in the
    // group. Reading only the filaments loses the indexed faces and leaves the model in one colour.
    const group = await loadThreeMfGroup(await threeMf("indexed-project", INDEXED_IN_PROJECT_XML, PROJECT_SETTINGS));
    expect(meshColors(group as import("three").Object3D)).toEqual([
      { color: "00ff00", triangles: 1 },
      { color: "ffff00", triangles: 1 },
    ]);
  });

  it("colours a part file's faces from its own group, not from one that shares its ids", async () => {
    const group = await loadThreeMfGroup(await threeMfWithPart("part-colours", PART_HOST_XML, PART_XML));
    expect(meshColors(group as import("three").Object3D)).toEqual([
      { color: "00ff00", triangles: 1 },
      { color: "ffff00", triangles: 1 },
    ]);
  });

  it("leaves a model that carries no colours as one mesh", async () => {
    const plain = COLOURED_XML.replace(/<m:colorgroup id="1">.*?<\/m:colorgroup>/s, "")
      .replace(' pid="1" pindex="0"', "")
      .replace(/ p1="\d+" paint_color="[^"]*"/g, "");
    const group = await loadThreeMfGroup(await threeMf("plain", plain));
    expect(meshColors(group as import("three").Object3D)).toHaveLength(1);
  });
});
