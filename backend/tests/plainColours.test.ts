import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  adapt3mf,
  classify3mf,
  planAdaptation,
  planKey,
  slicerProfile,
  storedFormat,
  type AdaptPlan,
  type ThreeMfFormat,
} from "../src/adapter";
import { FORMAT_VERSION } from "../src/adapter/format";
import { readPlainPackage } from "../src/adapter/readers/plainProject";

// Pure: no database.

const NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"';

const triangle = (
  id: string,
  name: string,
  colour: string,
  x = 0,
) => `  <object id="${id}" type="model" name="${name}" ${colour}>
   <mesh>
    <vertices><vertex x="${x}" y="0" z="0"/><vertex x="${x + 1}" y="0" z="0"/><vertex x="${x}" y="1" z="0"/><vertex x="${x + 1}" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="1" v2="3" v3="2"/></triangles>
   </mesh>
  </object>`;

/** A keyring like Thingport's: a base and two letters as parts of one object, the letters another colour; a tag of
 *  its own beside it, painted per triangle. */
function plainModel(unit = "millimeter"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" ${NS}>
 <metadata name="Title">Keyring</metadata>
 <metadata name="Application">Thingport keyring generator</metadata>
 <resources>
  <m:colorgroup id="10"><m:color color="#77916AFF"/></m:colorgroup>
  <m:colorgroup id="11"><m:color color="#F0EEDFFF"/><m:color color="#C52C18"/></m:colorgroup>
  <basematerials id="12"><base name="Black" displaycolor="#000000FF"/></basematerials>
${triangle("1", "base", 'pid="10" pindex="0"')}
${triangle("2", "letter T", 'pid="11" pindex="0"', 5)}
${triangle("3", "letter h", 'pid="11" pindex="0"', 8)}
  <object id="4" type="model" name="Keyring">
   <components>
    <component objectid="1"/>
    <component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 2"/>
    <component objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 2"/>
   </components>
  </object>
  <object id="5" type="model" name="Tag" pid="12" pindex="0">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="1" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2" pid="11" p1="1"/><triangle v1="1" v2="3" v3="2"/></triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="4" transform="1 0 0 0 1 0 0 0 1 10 20 0"/>
  <item objectid="5" transform="1 0 0 0 1 0 0 0 1 40 20 0"/>
 </build>
</model>`;
}

async function plainZip(model = plainModel()): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", model);
  zip.file("Metadata/thumbnail.png", "png");
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships/>');
  return zip.generateAsync({ type: "uint8array" });
}

const PLAIN: ThreeMfFormat = {
  v: FORMAT_VERSION,
  kind: "plain",
  app: "Thingport keyring generator",
  appVersion: null,
  orcaTag: null,
  printer: null,
  nozzle: null,
  filaments: 4,
  plates: null,
  dialect: null,
  painted: false,
};

async function copyOf(bytes: Uint8Array, plan: AdaptPlan) {
  const written = await adapt3mf(bytes, plan);
  const zip = await JSZip.loadAsync(await written.zip.generateAsync({ type: "uint8array" }));
  const text = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`missing ${name}`);
    return file.async("string");
  };
  return { zip, text, report: written.report() };
}

describe("a plain 3MF's colours", () => {
  it("are classified from what the whole model says, for the slicers that read none", () => {
    const files = {
      entries: ["3D/3dmodel.model"],
      modelHead: plainModel(),
      projectSettings: null,
      modelSettings: null,
      prusaConfig: null,
    };
    expect(classify3mf(files)).toMatchObject({ kind: "plain", filaments: null });
    expect(classify3mf({ ...files, plainModel: { colours: 4, painted: false } })).toMatchObject({
      kind: "plain",
      filaments: 4,
      painted: false,
    });
    expect(storedFormat(PLAIN)).toEqual(PLAIN);
  });

  it("get copies for PrusaSlicer, eufyMake Studio and Cura", () => {
    expect(planAdaptation(PLAIN, slicerProfile("prusaslicer"))).toEqual({ output: "prusa", from: "plain" });
    expect(planAdaptation(PLAIN, slicerProfile("eufystudio3d"))).toEqual({ output: "prusa", from: "plain" });
    expect(planAdaptation(PLAIN, slicerProfile("cura"))).toEqual({ output: "cura", from: "plain" });
    // One colour is nothing to keep, painting PrusaSlicer reads is kept as it is, and the Bambu family reads colours.
    expect(planAdaptation({ ...PLAIN, filaments: 1 }, slicerProfile("prusaslicer"))).toBeNull();
    expect(planAdaptation({ ...PLAIN, painted: true }, slicerProfile("prusaslicer"))).toBeNull();
    expect(planAdaptation(PLAIN, slicerProfile("orcaslicer"))).toBeNull();
    expect(planKey({ output: "prusa", from: "plain" })).not.toBe(planKey({ output: "prusa" }));
  });

  it("are filaments, each object and part on its colour's, and a triangle of another painted", async () => {
    const pkg = await readPlainPackage(await plainZip());
    expect(pkg.settings.filament_colour).toEqual(["#77916A", "#F0EEDF", "#000000", "#C52C18"]);
    expect(pkg.modelSettings["4"]).toMatchObject({
      name: "Keyring",
      extruder: 1,
      parts: [
        { id: "1", name: "base", extruder: 1 },
        { id: "2", name: "letter T", extruder: 2 },
        { id: "3", name: "letter h", extruder: 2 },
      ],
    });
    expect(pkg.modelSettings["5"]).toMatchObject({ name: "Tag", extruder: 3, parts: [] });
    const root = await pkg.root.entry.async("string");
    // The tag's first triangle is the fourth colour; its other is the tag's own, left to its extruder.
    const tag = /<object id="5"[\s\S]*?<\/object>/.exec(root)?.[0] ?? "";
    expect([...tag.matchAll(/<triangle [^>]*\/>/g)].map((m) => m[0])).toEqual([
      '<triangle v1="0" v2="1" v3="2" paint_color="1C"/>',
      '<triangle v1="1" v2="3" v3="2"/>',
    ]);
    expect(root).not.toMatch(/<triangle [^>]*\bp1=/);
  });

  it("keep the filaments a file numbers them with itself", async () => {
    const zip = await JSZip.loadAsync(await plainZip());
    // A file that numbers its filaments itself, as Thingport's keyring generator does: here the base on the third,
    // the letters on the first.
    zip.file(
      "Metadata/model_settings.config",
      `<config><object id="4"><metadata key="extruder" value="1"/>
  <part id="1" subtype="normal_part"><metadata key="extruder" value="3"/></part>
  <part id="2" subtype="normal_part"><metadata key="extruder" value="1"/></part>
</object><object id="5"><metadata key="extruder" value="4"/></object></config>`,
    );
    const pkg = await readPlainPackage(zip);
    // A colour the file numbers none for takes the first number free.
    expect(pkg.settings.filament_colour).toEqual(["#F0EEDF", "#C52C18", "#77916A", "#000000"]);
    expect(pkg.modelSettings["4"].parts.map((part) => part.extruder)).toEqual([3, 1, 1]);
    expect(pkg.modelSettings["5"].extruder).toBe(4);
  });

  it("are in millimetres whatever unit the file is in", async () => {
    const pkg = await readPlainPackage(await plainZip(plainModel("centimeter")));
    const root = await pkg.root.entry.async("string");
    expect(root).toContain('unit="millimeter"');
    expect(root).toContain('<vertex x="50" y="0" z="0"/>');
    expect(root).toContain('<component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 20"/>');
    expect(root).toContain('<item objectid="4" transform="1 0 0 0 1 0 0 0 1 100 200 0"/>');
  });

  it("go into PrusaSlicer's copy as extruders and painting", async () => {
    const { text, report } = await copyOf(await plainZip(), { output: "prusa", from: "plain" });
    expect(report).toMatchObject({ output: "prusa" });
    const config = await text("Metadata/Slic3r_PE_model.config");
    // The keyring is one object of three volumes, the letters on the second extruder.
    expect(config).toContain('<metadata type="object" key="name" value="Keyring"/>');
    expect([...config.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => m[1])).toEqual([
      "1",
      "1",
      "2",
      "2",
      "3",
      "3",
    ]);
    const model = await text("3D/3dmodel.model");
    expect(model).toContain('slic3rpe:mmu_segmentation="1C"');
  });

  it("go into Cura's copy as each object's and part's extruder, a UCP with no settings to change", async () => {
    const { text } = await copyOf(await plainZip(), { output: "cura", from: "plain" });
    const model = await text("3D/3dmodel.model");
    // The keyring's parts, then the tag, a whole object, which Cura keeps on its extruder when opened as a UCP.
    expect([...model.matchAll(/name="cura:extruder_nr">(\d+)</g)].map((m) => m[1])).toEqual(["0", "1", "1", "2"]);
    expect(JSON.parse(await text("Cura/user-settings.json"))).toEqual({ global: {} });
  });
});
