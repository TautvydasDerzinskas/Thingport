import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  adapt3mf,
  classify3mf,
  COMPATIBLE_TAG,
  parseGenerator,
  planAdaptation,
  planKey,
  slicerProfile,
  versionAtMost,
  type AdaptPlan,
  type ThreeMfFormat,
} from "../src/adapter";
import { decodePaintState, encodePaintState, stateToMaterialIndex } from "../src/adapter/paint";
import { parsePlates } from "../src/adapter/readers/bambuProject";
import {
  curaObjectSettings,
  extractBambuSettings,
  normalizeProjectSettings,
  prusaObjectSettings,
  settingsDialectOf,
  settingsIn,
} from "../src/adapter/settings";
import { retagModelHead } from "../src/adapter/writers/bambu";

// Pure: no database. The cache test points storage at a temp dir before loading config.

const MODEL_NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

const SINGLE_COMPONENT_ROOT = `  <object id="2" p:UUID="root" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`;

function modelXml(
  body: string,
  head = ' <metadata name="Title">Test Cube</metadata>',
  app = "BambuStudio-02.08.02.61",
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${MODEL_NS}>
${head}
 <metadata name="Application">${app}</metadata>
 <resources>
${body}
 </resources>
 <build>
  <item objectid="2" p:UUID="bbbb" transform="1 0 0 0 1 0 0 0 1 10 20 3" printable="1"/>
 </build>
</model>
`;
}

const MESH_OBJECT = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" ${MODEL_NS}>
 <resources>
  <object id="1" p:UUID="aaaa" type="other">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="1" y="0" z="0"/>
     <vertex x="0" y="1" z="0"/>
     <vertex x="1" y="1" z="0"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" paint_color="4" paint_supports="8"/>
     <triangle v1="1" v2="3" v3="2" paint_color="8"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>
`;

const PROJECT_SETTINGS = {
  layer_height: "0.2",
  wall_loops: "3",
  line_width: "0.42",
  inner_wall_line_width: "0.45",
  sparse_infill_density: "15%",
  sparse_infill_pattern: "crosshatch",
  enable_support: "1",
  brim_type: "auto_brim",
  ensure_vertical_shell_thickness: "enabled",
  filament_colour: ["#FFFFFF", "#C52C18"],
  filament_type: ["PLA", "PLA"],
  nozzle_diameter: ["0.4"],
  nozzle_temperature: ["220", "220"],
  filament_settings_id: ["Generic PLA @BBL A1M", "Generic PLA @BBL A1M"],
  printer_settings_id: "Bambu Lab A1 mini 0.4 nozzle",
  printer_model: "Bambu Lab A1 mini",
  machine_start_gcode: "M104 S200",
  printable_area: ["0x0", "180x180"],
};

const MODEL_SETTINGS = `<?xml version="1.0"?>
<config>
  <object id="2">
    <metadata key="name" value="DesignerPart"/>
    <metadata key="extruder" value="2"/>
    <metadata key="sparse_infill_density" value="40%"/>
    <metadata key="ensure_vertical_shell_thickness" value="partial"/>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>
</config>`;

async function makeBambuZip(
  overrides: { rootXml?: string; settings?: Record<string, unknown> } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", overrides.rootXml ?? modelXml(SINGLE_COMPONENT_ROOT));
  zip.file("3D/Objects/object_1.model", MESH_OBJECT);
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships/>');
  zip.file("Metadata/project_settings.config", JSON.stringify(overrides.settings ?? PROJECT_SETTINGS));
  zip.file("Metadata/model_settings.config", MODEL_SETTINGS);
  zip.file("Metadata/slice_info.config", "<config/>");
  zip.file("3D/_rels/3dmodel.model.rels", "<Relationships/>");
  return zip.generateAsync({ type: "uint8array" });
}

const ASSEMBLY_ROOT = `<?xml version="1.0"?>
<model unit="millimeter" ${MODEL_NS}>
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <resources>
  <object id="6" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    <component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>
   </components>
  </object>
 </resources>
 <build><item objectid="6" transform="1 0 0 0 1 0 0 0 1 10 20 3" printable="1"/></build>
</model>`;

const ASSEMBLY_PARTS = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
   </mesh>
  </object>
  <object id="2" type="model">
   <mesh>
    <vertices><vertex x="2" y="0" z="0"/><vertex x="3" y="0" z="0"/><vertex x="2" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;

async function makeAssemblyZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", ASSEMBLY_ROOT);
  zip.file("3D/Objects/object_1.model", ASSEMBLY_PARTS);
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify({
      filament_colour: ["#FBFCFF", "#F2910B", "#000000"],
      filament_type: ["PLA", "PLA", "PLA"],
      wall_loops: "4",
    }),
  );
  zip.file(
    "Metadata/model_settings.config",
    `<?xml version="1.0"?>
<config>
  <object id="6">
    <metadata key="name" value="Chip"/>
    <metadata key="extruder" value="3"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="Background"/><metadata key="extruder" value="3"/></part>
    <part id="2" subtype="normal_part"><metadata key="name" value="QR"/><metadata key="extruder" value="1"/></part>
  </object>
</config>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function generate(input: Uint8Array, plan: AdaptPlan) {
  const written = await adapt3mf(input, plan);
  const bytes = await written.zip.generateAsync({ type: "uint8array" });
  return { bytes, zip: await JSZip.loadAsync(bytes), report: written.report() };
}

async function readOut(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) throw new Error(`missing ${name}`);
  return file.async("string");
}

function format(overrides: Partial<ThreeMfFormat> = {}): ThreeMfFormat {
  return {
    v: 1,
    kind: "bambu",
    app: "BambuStudio",
    appVersion: "02.08.02.61",
    orcaTag: null,
    printer: "Bambu Lab A1 mini 0.4 nozzle",
    nozzle: 0.4,
    filaments: 2,
    plates: 1,
    dialect: "bambu",
    ...overrides,
  };
}

describe("project settings", () => {
  it("merges legacy nested process_settings.1", () => {
    expect(extractBambuSettings({ process_settings: { "1": { wall_loops: "6" } } }).wall_loops).toBe("6");
  });

  it("strips the printer, machine limits, G-code and inherit sentinels", () => {
    const cleaned = normalizeProjectSettings({
      wall_loops: "3",
      filament_colour: ["#FFFFFF", "#C52C18"],
      extruder_colour: ["#018001"],
      filament_settings_id: ["Generic PLA @BBL A1M"],
      printer_model: "Bambu Lab A1 mini",
      machine_start_gcode: "M104",
      raft_first_layer_expansion: "-1",
      filament_retraction_length: ["nil", "nil"],
      wall_filament: "0",
    });
    expect(cleaned).toEqual({
      wall_loops: "3",
      filament_colour: ["#FFFFFF", "#C52C18"],
      extruder_colour: ["#FFFFFF", "#C52C18"],
    });
  });

  it("tells Bambu Studio's names from Orca's and translates between them", () => {
    expect(settingsDialectOf({ ensure_vertical_shell_thickness: "enabled" })).toBe("bambu");
    expect(settingsDialectOf({ ensure_vertical_shell_thickness: "ensure_moderate" })).toBe("orca");
    expect(settingsDialectOf({ ensure_vertical_shell_thickness: "1" })).toBeNull();
    expect(settingsIn("orca", { ensure_vertical_shell_thickness: "disabled" }).ensure_vertical_shell_thickness).toBe(
      "none",
    );
    expect(settingsIn("bambu", { ensure_vertical_shell_thickness: "ensure_all" }).ensure_vertical_shell_thickness).toBe(
      "enabled",
    );
  });

  it("gives PrusaSlicer the per-object settings it knows, in its own names", () => {
    const out = prusaObjectSettings(PROJECT_SETTINGS);
    expect(out).toMatchObject({
      layer_height: "0.2",
      perimeters: "3",
      fill_density: "15%",
      fill_pattern: "grid",
      support_material: "1",
      brim_type: "outer_only",
      ensure_vertical_shell_thickness: "enabled",
    });
    // Line widths belong to the user's nozzle, temperatures to their filament.
    expect(Object.keys(out)).not.toContain("extrusion_width");
    expect(Object.keys(out)).not.toContain("temperature");
    expect(prusaObjectSettings({ sparse_infill_pattern: "2dlattice" })).toEqual({});
  });

  it("gives Cura the walls, layers, infill and supports it takes per object", () => {
    expect(curaObjectSettings(PROJECT_SETTINGS)).toEqual({
      wall_line_count: "3",
      infill_sparse_density: "15",
      infill_pattern: "grid",
      support_enable: "True",
    });
  });
});

describe("paint state", () => {
  it("round-trips Bambu TriangleSelector states", () => {
    expect(decodePaintState("4")).toBe(1);
    expect(decodePaintState("8")).toBe(2);
    expect(decodePaintState("0C")).toBe(3);
    expect(decodePaintState("2C")).toBe(5);
    expect(decodePaintState("")).toBe(0);
    expect(encodePaintState(1)).toBe("4");
    expect(encodePaintState(3)).toBe("0C");
    expect(decodePaintState(encodePaintState(4))).toBe(4);
    expect(stateToMaterialIndex(1, 2, 5)).toBe(0);
    expect(stateToMaterialIndex(0, 2, 5)).toBe(1);
    expect(stateToMaterialIndex(5, 1, 5)).toBe(4);
  });
});

describe("classify3mf", () => {
  it("names the app and version a file says wrote it", () => {
    expect(parseGenerator("BambuStudio-02.08.02.61")).toEqual({ app: "BambuStudio", version: "02.08.02.61" });
    expect(parseGenerator("Creality_Print V7.2.1.5476 Release")).toEqual({
      app: "Creality_Print",
      version: "7.2.1.5476",
    });
    expect(parseGenerator("PrusaSlicer-2.7.4+win64")).toEqual({ app: "PrusaSlicer", version: "2.7.4" });
    expect(parseGenerator("eufyMake Studio-1.5.26")).toEqual({ app: "eufyMake Studio", version: "1.5.26" });
    expect(parseGenerator("Thingport")).toEqual({ app: "Thingport", version: null });
  });

  it("reads a Bambu project's printer, filaments, plates and settings names", async () => {
    const zip = await JSZip.loadAsync(await makeBambuZip());
    const result = classify3mf({
      entries: Object.keys(zip.files),
      modelHead: await readOut(zip, "3D/3dmodel.model"),
      projectSettings: await readOut(zip, "Metadata/project_settings.config"),
      modelSettings: MODEL_SETTINGS,
      prusaConfig: null,
    });
    expect(result).toEqual(format({ plates: 1 }));
  });

  it("tells PrusaSlicer projects, sliced files, Cura projects and plain 3MFs apart", () => {
    const base = { modelHead: null, projectSettings: null, modelSettings: null, prusaConfig: null };
    const prusa = classify3mf({
      ...base,
      entries: ["3D/3dmodel.model", "Metadata/Slic3r_PE.config"],
      modelHead: '<model><metadata name="Application">PrusaSlicer-2.9.2</metadata>',
      prusaConfig:
        "; printer_settings_id = Original Prusa MK4S\n; nozzle_diameter = 0.4\n; filament_colour = #FF0000;#00FF00",
    });
    expect(prusa).toMatchObject({ kind: "prusa", app: "PrusaSlicer", printer: "Original Prusa MK4S", filaments: 2 });
    expect(classify3mf({ ...base, entries: ["Metadata/plate_1.gcode", "Metadata/project_settings.config"] }).kind).toBe(
      "sliced",
    );
    expect(classify3mf({ ...base, entries: ["3D/3dmodel.model", "Cura/x.global.cfg"] }).kind).toBe("cura");
    expect(classify3mf({ ...base, entries: ["3D/3dmodel.model"] }).kind).toBe("plain");
    // What Thingport's own tools write: colour groups and painting every slicer reads, with part names beside them.
    const tool = classify3mf({ ...base, entries: ["3D/3dmodel.model", "Metadata/model_settings.config"] });
    expect(tool.kind).toBe("plain");
  });

  it("notes the OrcaSlicer tag Orca 2.5 writes beside a Bambu one", () => {
    const result = classify3mf({
      entries: ["3D/3dmodel.model", "Metadata/project_settings.config"],
      modelHead:
        '<model><metadata name="Application">BambuStudio-02.08.01.55</metadata><metadata name="OrcaSlicer">2.5.0</metadata>',
      projectSettings: JSON.stringify({ ensure_vertical_shell_thickness: "ensure_all" }),
      modelSettings: null,
      prusaConfig: null,
    });
    expect(result).toMatchObject({ kind: "bambu", orcaTag: "2.5.0", dialect: "orca" });
  });
});

describe("planAdaptation", () => {
  const plan = (slicer: string, f = format()) => planAdaptation(f, slicerProfile(slicer));

  it("compares versions with zero-padded parts", () => {
    expect(versionAtMost("02.03.02.00", "2.3.2")).toBe(true);
    expect(versionAtMost("02.03.02.61", "2.3.2")).toBe(false);
    expect(versionAtMost("02.01.00.00", "2.3.1")).toBe(true);
  });

  it("leaves a MakerWorld project as it is for Bambu Studio", () => {
    expect(plan("bambustudio")).toBeNull();
  });

  it("translates its settings' names for the Orca family, and retags it where a version would be questioned", () => {
    expect(plan("orcaslicer")).toEqual({ output: "bambu", tag: null, dropOrcaTag: false, dialect: "orca" });
    expect(plan("snapmaker-orca")).toEqual({ output: "bambu", tag: null, dropOrcaTag: false, dialect: "orca" });
    expect(plan("elegooslicer")).toEqual({ output: "bambu", tag: COMPATIBLE_TAG, dropOrcaTag: false, dialect: "orca" });
    expect(plan("anycubicslicernext")).toEqual({
      output: "bambu",
      tag: COMPATIBLE_TAG,
      dropOrcaTag: false,
      dialect: "orca",
    });
  });

  it("keeps another maker's project foreign to Creality Print, which asks for a printer", () => {
    expect(plan("crealityprintlink")).toEqual({ output: "bambu", tag: null, dropOrcaTag: false, dialect: "orca" });
    expect(plan("crealityprintlink", format({ dialect: "orca" }))).toBeNull();
  });

  it("flattens it for PrusaSlicer, eufyMake Studio and Cura", () => {
    expect(plan("prusaslicer")).toEqual({ output: "prusa" });
    expect(plan("eufystudio3d")).toEqual({ output: "prusa" });
    expect(plan("cura")).toEqual({ output: "cura" });
  });

  it("retags a fork's project for slicers that don't take its tag", () => {
    const snapmaker = format({ app: "Snapmaker_Orca", appVersion: "2.4.1", dialect: "orca" });
    expect(plan("snapmaker-orca", snapmaker)).toBeNull();
    expect(plan("orcaslicer", snapmaker)).toMatchObject({ tag: COMPATIBLE_TAG });
    expect(plan("bambustudio", snapmaker)).toEqual({
      output: "bambu",
      tag: COMPATIBLE_TAG,
      dropOrcaTag: false,
      dialect: "bambu",
    });
  });

  it("drops an OrcaSlicer tag Elegoo Slicer would warn about", () => {
    const orca25 = format({ appVersion: "02.08.01.55", orcaTag: "2.5.0", dialect: "orca" });
    expect(plan("orcaslicer", orca25)).toBeNull();
    expect(plan("elegooslicer", orca25)).toEqual({
      output: "bambu",
      tag: COMPATIBLE_TAG,
      dropOrcaTag: true,
      dialect: null,
    });
  });

  it("makes nothing of other kinds of file, or for a slicer it doesn't know", () => {
    for (const kind of ["prusa", "cura", "plain", "sliced"] as const) expect(plan("cura", format({ kind }))).toBeNull();
    expect(plan("other")).toBeNull();
    expect(planAdaptation(null, slicerProfile("prusaslicer"))).toBeNull();
  });

  it("names copies by what's in them, so slicers getting the same one share it", () => {
    expect(planKey({ output: "prusa" })).toBe("prusa");
    expect(planKey({ output: "bambu", tag: COMPATIBLE_TAG, dropOrcaTag: true, dialect: "orca" })).toBe(
      "bambu-tag-noorca-orca",
    );
    expect(planKey(plan("orcaslicer")!)).toBe(planKey(plan("snapmaker-orca")!));
  });
});

describe("the PrusaSlicer copy", () => {
  it("is one core model with no project settings, so it joins the user's own setup", async () => {
    const { zip } = await generate(await makeBambuZip(), { output: "prusa" });
    for (const gone of [
      "3D/Objects/object_1.model",
      "Metadata/Slic3r_PE.config",
      "Metadata/project_settings.config",
      "Metadata/model_settings.config",
      "Metadata/slice_info.config",
    ]) {
      expect(zip.file(gone)).toBeNull();
    }
    const xml = await readOut(zip, "3D/3dmodel.model");
    expect(xml).toMatch(/<vertex /);
    expect(xml).not.toMatch(/requiredextensions|p:path|xmlns:p=|type="other"|slic3r:/);
    expect(xml).toMatch(/<metadata name="Application">Thingport<\/metadata>/);
    expect(xml).toMatch(/<metadata name="Title">Test Cube<\/metadata>/);
  });

  it("keeps painting under PrusaSlicer's names and the filament colours", async () => {
    const { zip, report } = await generate(await makeBambuZip(), { output: "prusa" });
    const xml = await readOut(zip, "3D/3dmodel.model");
    expect(xml).toMatch(/paint_color="4" slic3rpe:mmu_segmentation="4"/);
    expect(xml).toMatch(/slic3rpe:custom_supports="8"/);
    expect(xml).toMatch(/displaycolor="#C52C18FF"/);
    expect(report.stats).toMatchObject({ paintColors: 2, triangles: 2, vertices: 4 });
  });

  it("carries the designer's settings per object, its own changes on top", async () => {
    const { zip } = await generate(await makeBambuZip(), { output: "prusa" });
    const config = await readOut(zip, "Metadata/Slic3r_PE_model.config");
    expect(config).toMatch(/key="name" value="DesignerPart"/);
    expect(config).toMatch(/key="perimeters" value="3"/);
    expect(config).toMatch(/key="fill_density" value="40%"/);
    expect(config).toMatch(/key="ensure_vertical_shell_thickness" value="partial"/);
    expect(config).not.toMatch(/extrusion_width/);
  });

  it("merges a multi-part object into one with a volume per part", async () => {
    const { zip } = await generate(await makeAssemblyZip(), { output: "prusa" });
    const xml = await readOut(zip, "3D/3dmodel.model");
    expect(xml.match(/<item\b/g)).toHaveLength(1);
    expect(xml).toMatch(/paint_color="0C"/);
    expect(xml).toMatch(/paint_color="4"/);
    const config = await readOut(zip, "Metadata/Slic3r_PE_model.config");
    expect(config).toMatch(/<volume firstid="0" lastid="0">/);
    expect(config).toMatch(/<volume firstid="1" lastid="1">/);
    expect(config).toMatch(/value="QR"/);
  });

  it("rejects archives without a model", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "no model");
    await expect(adapt3mf(await zip.generateAsync({ type: "uint8array" }), { output: "prusa" })).rejects.toThrow(
      /No valid 3D model/,
    );
  });
});

describe("the Cura copy", () => {
  it("keeps a multi-part object a group whose parts have their own extruders", async () => {
    const { zip } = await generate(await makeAssemblyZip(), { output: "cura" });
    const xml = await readOut(zip, "3D/3dmodel.model");
    expect(xml).toMatch(/<components>\n {4}<component objectid="\d+"\/>\n {4}<component objectid="\d+"\/>/);
    const extruders = [...xml.matchAll(/<metadata name="cura:extruder_nr">(\d+)<\/metadata>/g)].map((m) => m[1]);
    expect(extruders).toEqual(["2", "0"]);
    expect(xml).toMatch(/<metadata name="cura:wall_line_count">4<\/metadata>/);
    expect(xml).not.toMatch(/paint_color/);
  });
});

describe("the Bambu layout copy", () => {
  it("retags it, translates its settings' names and leaves everything else as it was", async () => {
    const input = await makeBambuZip();
    const { zip, report } = await generate(input, {
      output: "bambu",
      tag: COMPATIBLE_TAG,
      dropOrcaTag: false,
      dialect: "orca",
    });
    const source = await JSZip.loadAsync(input);
    expect(await readOut(zip, "3D/Objects/object_1.model")).toBe(await readOut(source, "3D/Objects/object_1.model"));
    expect(await readOut(zip, "Metadata/slice_info.config")).toBe("<config/>");
    const root = await readOut(zip, "3D/3dmodel.model");
    expect(root).toMatch(new RegExp(`<metadata name="Application">${COMPATIBLE_TAG}</metadata>`));
    expect(root).toMatch(/<metadata name="Title">Test Cube<\/metadata>/);
    expect(root).toMatch(/p:path="\/3D\/Objects\/object_1.model"/);
    const project = JSON.parse(await readOut(zip, "Metadata/project_settings.config"));
    expect(project.ensure_vertical_shell_thickness).toBe("ensure_all");
    expect(project.printer_settings_id).toBe("Bambu Lab A1 mini 0.4 nozzle");
    const objects = await readOut(zip, "Metadata/model_settings.config");
    expect(objects).toMatch(/key="ensure_vertical_shell_thickness" value="ensure_moderate"/);
    expect(parsePlates(objects)).toHaveLength(1);
    expect(report).toMatchObject({ output: "bambu", retagged: true, translated: true });
  });

  it("drops an OrcaSlicer tag and adds an Application tag a file lacks", () => {
    const head = '<model a="1">\n <metadata name="OrcaSlicer">2.5.0</metadata>\n <metadata name="Title">X</metadata>\n';
    const out = retagModelHead(head, COMPATIBLE_TAG, true);
    expect(out).not.toMatch(/OrcaSlicer/);
    expect(out).toMatch(new RegExp(`<model a="1">\n <metadata name="Application">${COMPATIBLE_TAG}</metadata>`));
  });
});

describe("adapted3mfFor", () => {
  it("adapts in a worker, caches the copy, falls back to null for a broken file and deletes a plate's copies", async () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-adapt-"));
    process.env.FILE_STORAGE = storage;
    const { adapted3mfFor, deleteAdapted3mfs } = await import("../src/services/adapted3mfCache");

    const src = path.join(storage, "model.3mf");
    fs.writeFileSync(src, await makeBambuZip());
    const first = await adapted3mfFor("plate-a", src, { output: "prusa" });
    expect(first).not.toBeNull();
    expect(await readOut(await JSZip.loadAsync(fs.readFileSync(first!)), "3D/3dmodel.model")).toMatch(/Thingport/);
    const mtime = fs.statSync(first!).mtimeMs;
    expect(await adapted3mfFor("plate-a", src, { output: "prusa" })).toBe(first);
    expect(fs.statSync(first!).mtimeMs).toBe(mtime);
    const cura = await adapted3mfFor("plate-a", src, { output: "cura" });
    expect(cura).not.toBe(first);

    const broken = path.join(storage, "broken.3mf");
    fs.writeFileSync(broken, "not a zip");
    expect(await adapted3mfFor("plate-b", broken, { output: "prusa" })).toBeNull();

    await deleteAdapted3mfs("plate-a");
    expect(fs.existsSync(first!)).toBe(false);
    expect(fs.existsSync(cura!)).toBe(false);
    fs.rmSync(storage, { recursive: true, force: true });
  });
});
