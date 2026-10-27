// The original 3MF Sanitizer's tests, run against the built tool.js: its MiniZip stands in for JSZip. Run with
//   node source/test_sanitizer.mjs
// The two real-file tests run when SAMPLE_BAMBU and SAMPLE_MAKERCHIP name those 3MFs on disk.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { ThreeMFSanitizer: sanitizer, MiniZip: JSZip } = await import(pathToFileURL(path.join(here, "../tool.js")).href);

const SAMPLE_BAMBU = process.env.SAMPLE_BAMBU || "Knafs_Yuti_Scales.3mf";
const SAMPLE_MAKERCHIP = process.env.SAMPLE_MAKERCHIP || "K2_MakerChip_Sample.3mf";

function modelXml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Title">Test Cube</metadata>
 <metadata name="Application">BambuStudio-02.07.01.57</metadata>
 <resources>
${body}
 </resources>
 <build>
  <item objectid="2" p:UUID="bbbb" transform="1 0 0 0 1 0 0 0 1 10 20 3" printable="1"/>
 </build>
</model>
`;
}

function meshObjectXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
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
     <triangle v1="0" v2="1" v3="2" paint_color="4"/>
     <triangle v1="1" v2="3" v3="2" paint_color="8"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>
`;
}

async function makeBambuZip(overrides = {}) {
  const zip = new JSZip();
  const root =
    overrides.rootXml ||
    modelXml(`  <object id="2" p:UUID="root" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`);
  zip.file("3D/3dmodel.model", root);
  zip.file("3D/Objects/object_1.model", overrides.objectXml || meshObjectXml());
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships/>');
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify(
      overrides.settings || {
        layer_height: "0.2",
        wall_loops: "3",
        line_width: "0.42",
        inner_wall_line_width: "0.45",
        outer_wall_line_width: "0.42",
        sparse_infill_density: "15%",
        sparse_infill_pattern: "crosshatch",
        enable_support: "1",
        filament_colour: ["#FFFFFF", "#C52C18"],
        filament_type: ["PLA", "PLA"],
        filament_diameter: ["1.75", "1.75"],
        nozzle_temperature: ["220", "220"],
        filament_settings_id: ["Generic PLA @BBL A1M", "Generic PLA @BBL A1M"],
        printer_model: "Bambu Lab A1 mini",
        machine_start_gcode: "M104 S200",
        printable_area: ["0x0", "180x180"],
      },
    ),
  );
  zip.file(
    "Metadata/model_settings.config",
    `<?xml version="1.0"?>
<config>
  <object id="2">
    <metadata key="name" value="DesignerPart"/>
    <metadata key="extruder" value="2"/>
  </object>
</config>`,
  );
  zip.file("Metadata/slice_info.config", "<config/>");
  zip.file("Metadata/plate_1.gcode", "; gcode");
  zip.file("3D/_rels/3dmodel.model.rels", "<Relationships/>");
  return zip.generateAsync({ type: "uint8array" });
}

async function sanitizeBytes(bytes) {
  return sanitizer.sanitize3mf(JSZip, bytes);
}

async function loadOutput(result) {
  return JSZip.loadAsync(result.bytes);
}

describe("extractBambuSettings", () => {
  test("reads flat Bambu project_settings, not process_settings.1", () => {
    const flat = { wall_loops: "4", layer_height: "0.16", line_width: "0.42" };
    assert.equal(sanitizer.extractBambuSettings(flat).wall_loops, "4");
    assert.equal(sanitizer.extractBambuSettings(flat).process_settings, undefined);
  });

  test("still merges legacy nested process_settings.1 when present", () => {
    const nested = {
      printer_model: "X1",
      process_settings: { 1: { wall_loops: "6" } },
    };
    assert.equal(sanitizer.extractBambuSettings(nested).wall_loops, "6");
  });
});

describe("mapSettingsToSlic3r", () => {
  test("maps walls, layer height, line widths, and keeps infill as percent", () => {
    const mapped = sanitizer.mapSettingsToSlic3r({
      layer_height: "0.2",
      wall_loops: "3",
      line_width: "0.42",
      inner_wall_line_width: "0.45",
      outer_wall_line_width: "0.42",
      sparse_infill_density: "15%",
      sparse_infill_pattern: "crosshatch",
      enable_support: "1",
    });
    assert.equal(mapped.layer_height, "0.2");
    assert.equal(mapped.perimeters, "3");
    assert.equal(mapped.extrusion_width, "0.42");
    assert.equal(mapped.perimeter_extrusion_width, "0.45");
    assert.equal(mapped.external_perimeter_extrusion_width, "0.42");
    assert.equal(mapped.fill_density, "15%");
    assert.equal(mapped.fill_pattern, "grid");
    assert.equal(mapped.support_material, "1");
  });

  test("keeps filament arrays and copies them to extruder_colour", () => {
    const mapped = sanitizer.mapSettingsToSlic3r({
      filament_colour: ["#FFFFFF", "#C52C18"],
      filament_type: ["PLA", "PETG"],
      nozzle_temperature: ["210", "240"],
    });
    assert.deepEqual(mapped.filament_colour, ["#FFFFFF", "#C52C18"]);
    assert.deepEqual(mapped.filament_type, ["PLA", "PETG"]);
    assert.deepEqual(mapped.extruder_colour, ["#FFFFFF", "#C52C18"]);
    assert.deepEqual(mapped.temperature, ["210", "240"]);
  });

  test("replaces a single Bambu extruder_colour with the full filament palette", () => {
    const mapped = sanitizer.mapSettingsToSlic3r({
      filament_colour: ["#FFFFFF", "#161616", "#C52C18"],
      extruder_colour: ["#018001"],
    });
    assert.deepEqual(mapped.extruder_colour, ["#FFFFFF", "#161616", "#C52C18"]);
  });
});

describe("sanitizeProjectSettings", () => {
  test("keeps designer process settings and strips printer/machine keys", () => {
    const cleaned = sanitizer.sanitizeProjectSettings({
      wall_loops: "3",
      line_width: "0.42",
      filament_colour: ["#FFFFFF", "#C52C18"],
      extruder_colour: ["#018001"],
      filament_type: ["PLA", "PLA"],
      filament_settings_id: ["Generic PLA @BBL A1M"],
      printer_model: "Bambu Lab A1 mini",
      machine_start_gcode: "M104",
      printable_area: ["0x0"],
      use_relative_e_distances: "1",
      before_layer_change_gcode: "",
      raft_first_layer_expansion: "-1",
      tree_support_wall_count: -1,
      filament_retraction_length: ["nil", "nil"],
      ironing_fan_speed: ["-1", "-1"],
      ensure_vertical_shell_thickness: "enabled",
      wall_filament: "0",
      solid_infill_filament: "0",
      sparse_infill_filament: "0",
      support_filament: "0",
    });
    assert.equal(cleaned.wall_loops, "3");
    assert.equal(cleaned.line_width, "0.42");
    assert.deepEqual(cleaned.filament_colour, ["#FFFFFF", "#C52C18"]);
    assert.deepEqual(cleaned.filament_type, ["PLA", "PLA"]);
    assert.deepEqual(cleaned.extruder_colour, ["#FFFFFF", "#C52C18"]);
    assert.equal(cleaned.filament_settings_id, undefined);
    assert.equal(cleaned.printer_model, undefined);
    assert.equal(cleaned.machine_start_gcode, undefined);
    assert.equal(cleaned.printable_area, undefined);
    assert.equal(cleaned.use_relative_e_distances, undefined);
    assert.equal(cleaned.before_layer_change_gcode, undefined);
    assert.equal(cleaned.raft_first_layer_expansion, undefined);
    assert.equal(cleaned.tree_support_wall_count, undefined);
    assert.equal(cleaned.filament_retraction_length, undefined);
    assert.equal(cleaned.ironing_fan_speed, undefined);
    assert.equal(cleaned.ensure_vertical_shell_thickness, "ensure_all");
    assert.equal(cleaned.wall_filament, undefined);
    assert.equal(cleaned.solid_infill_filament, undefined);
    assert.equal(cleaned.sparse_infill_filament, undefined);
    assert.equal(cleaned.support_filament, undefined);
  });
});

describe("decodePaintState", () => {
  test("decodes Bambu TriangleSelector hex to extruder state", () => {
    assert.equal(sanitizer.decodePaintState("4"), 1);
    assert.equal(sanitizer.decodePaintState("8"), 2);
    assert.equal(sanitizer.decodePaintState("0C"), 3);
    assert.equal(sanitizer.decodePaintState("2C"), 5);
    assert.equal(sanitizer.decodePaintState(""), 0);
    assert.equal(sanitizer.encodePaintState(1), "4");
    assert.equal(sanitizer.encodePaintState(2), "8");
    assert.equal(sanitizer.encodePaintState(3), "0C");
    assert.equal(sanitizer.encodePaintState(5), "2C");
    assert.equal(sanitizer.decodePaintState(sanitizer.encodePaintState(4)), 4);
    assert.equal(sanitizer.stateToMaterialIndex(1, 2, 5), 0);
    assert.equal(sanitizer.stateToMaterialIndex(0, 2, 5), 1);
    assert.equal(sanitizer.stateToMaterialIndex(5, 1, 5), 4);
  });
});

describe("sanitize3mf", () => {
  test("flattens production extension and drops requiredextensions", async () => {
    const result = await sanitizeBytes(await makeBambuZip());
    const out = await loadOutput(result);
    assert.equal(!!out.file("3D/Objects/object_1.model"), false);
    const xml = await out.file("3D/3dmodel.model").async("string");
    assert.match(xml, /<vertex /);
    assert.match(xml, /<triangle /);
    assert.doesNotMatch(xml, /requiredextensions/);
    assert.doesNotMatch(xml, /p:path/);
    assert.doesNotMatch(xml, /xmlns:p=/);
    assert.ok(result.report.flattened);
  });

  test("preserves paint_color and filament colors as basematerials", async () => {
    const result = await sanitizeBytes(await makeBambuZip());
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    assert.match(xml, /paint_color="4"/);
    assert.match(xml, /paint_color="8"/);
    assert.match(xml, /slic3rpe:mmu_segmentation="4"/);
    assert.match(xml, /p1="0"/);
    assert.match(xml, /p1="1"/);
    assert.match(xml, /<basematerials /);
    assert.match(xml, /displaycolor="#FFFFFFFF"/);
    assert.match(xml, /displaycolor="#C52C18FF"/);
    assert.equal(result.report.paintColors, 2);
    assert.equal(result.report.triangles, 2);
    assert.equal(result.report.vertices, 4);
  });

  test("writes slic3r settings without nesting inside existing metadata", async () => {
    const result = await sanitizeBytes(await makeBambuZip());
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    assert.match(xml, /<metadata name="Title">Test Cube<\/metadata>/);
    assert.match(xml, /<metadata name="slic3r:perimeters">3<\/metadata>/);
    assert.match(xml, /<metadata name="slic3r:fill_density">15%<\/metadata>/);
    assert.doesNotMatch(xml, /<metadata name="Title">[^<]*<metadata name="slic3r:/);
    const slic3r = await out.file("Metadata/Slic3r_PE.config").async("string");
    assert.match(slic3r, /; perimeters = 3/);
    assert.match(slic3r, /; extrusion_width = 0.42/);
    assert.match(slic3r, /; fill_density = 15%/);
  });

  test("writes empty Copyright as a self-closing metadata tag", async () => {
    const rootXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Title">Broly</metadata>
 <metadata name="Copyright">
 <metadata name="Designer">MakerWorld</metadata>
 <resources>
  <object id="2" p:UUID="root" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" p:UUID="bbbb" transform="1 0 0 0 1 0 0 0 1 10 20 3" printable="1"/>
 </build>
</model>
`;
    const result = await sanitizeBytes(await makeBambuZip({ rootXml }));
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    assert.match(xml, /<metadata name="Copyright" \/>/);
    assert.match(xml, /<metadata name="Title">Broly<\/metadata>/);
    assert.match(xml, /<metadata name="Designer">MakerWorld<\/metadata>/);
    assert.doesNotMatch(xml, /<metadata name="Copyright">/);
    assert.doesNotMatch(xml, /<metadata name="Copyright"><\/metadata>/);
  });

  test("keeps self-closing and empty paired Copyright metadata self-closing", async () => {
    const rootXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Title">Broly</metadata>
 <metadata name="Copyright" />
 <metadata name="Description"></metadata>
 <resources>
  <object id="2" p:UUID="root" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" p:UUID="bbbb" transform="1 0 0 0 1 0 0 0 1 10 20 3" printable="1"/>
 </build>
</model>
`;
    const result = await sanitizeBytes(await makeBambuZip({ rootXml }));
    const xml = await (await loadOutput(result)).file("3D/3dmodel.model").async("string");
    assert.match(xml, /<metadata name="Copyright" \/>/);
    assert.match(xml, /<metadata name="Description" \/>/);
    assert.doesNotMatch(xml, /<metadata name="Copyright">/);
    assert.doesNotMatch(xml, /<metadata name="Description">/);
  });

  test("strips gcode, slice_info, and Bambu printer profile", async () => {
    const result = await sanitizeBytes(await makeBambuZip());
    const out = await loadOutput(result);
    assert.equal(!!out.file("Metadata/plate_1.gcode"), false);
    assert.equal(!!out.file("Metadata/slice_info.config"), false);
    assert.equal(!!out.file("3D/_rels/3dmodel.model.rels"), false);
    const project = JSON.parse(await out.file("Metadata/project_settings.config").async("string"));
    assert.equal(project.wall_loops, "3");
    assert.deepEqual(project.filament_colour, ["#FFFFFF", "#C52C18"]);
    assert.deepEqual(project.filament_type, ["PLA", "PLA"]);
    assert.equal(project.filament_settings_id, undefined);
    assert.equal(project.printer_model, undefined);
    assert.equal(project.machine_start_gcode, undefined);
    const slic3r = await out.file("Metadata/Slic3r_PE.config").async("string");
    assert.match(slic3r, /; filament_colour = #FFFFFF;#C52C18/);
    assert.match(slic3r, /; extruder_colour = #FFFFFF;#C52C18/);
    const modelCfg = await out.file("Metadata/model_settings.config").async("string");
    assert.match(modelCfg, /key="extruder"/);
  });

  test("converts type=other to model and remaps shared production parts", async () => {
    const result = await sanitizeBytes(await makeBambuZip());
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    assert.doesNotMatch(xml, /type="other"/);
    assert.match(xml, /type="model"/);
    assert.match(xml, /<item objectid="/);
  });

  test("rejects archives without a 3dmodel.model", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "no model");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await assert.rejects(() => sanitizeBytes(bytes), /No valid 3D model/);
  });

  test("still sanitizes an already-flat generic 3MF", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build>
</model>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await sanitizeBytes(bytes);
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    assert.match(xml, /<triangle /);
    assert.equal(result.report.triangles, 1);
    assert.equal(result.report.flattened, false);
    assert.match(xml, /pid="/);
  });

  test("keeps multi-part assemblies as one merged object with per-part filaments", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
  <object id="6" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    <component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>
   </components>
  </object>
 </resources>
 <build><item objectid="6" transform="1 0 0 0 1 0 0 0 1 10 20 3" printable="1"/></build>
</model>`,
    );
    zip.file(
      "3D/Objects/object_1.model",
      `<?xml version="1.0"?>
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
</model>`,
    );
    zip.file(
      "Metadata/project_settings.config",
      JSON.stringify({
        filament_colour: ["#FBFCFF", "#F2910B", "#000000"],
        filament_type: ["PLA", "PLA", "PLA"],
      }),
    );
    zip.file(
      "Metadata/model_settings.config",
      `<?xml version="1.0"?>
<config>
  <object id="6">
    <metadata key="name" value="Chip"/>
    <metadata key="extruder" value="3"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="Background"/>
      <metadata key="extruder" value="3"/>
    </part>
    <part id="2" subtype="normal_part">
      <metadata key="name" value="QR"/>
      <metadata key="extruder" value="1"/>
    </part>
  </object>
</config>`,
    );
    const result = await sanitizeBytes(await zip.generateAsync({ type: "uint8array" }));
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    const items = xml.match(/<item\b/g) || [];
    assert.equal(items.length, 1);
    assert.match(xml, /p1="2"/);
    assert.match(xml, /p1="0"/);
    assert.match(xml, /paint_color="0C"/);
    assert.match(xml, /paint_color="4"/);
    const modelCfg = await out.file("Metadata/model_settings.config").async("string");
    assert.match(modelCfg, /value="Background"/);
    assert.match(modelCfg, /value="QR"/);
    assert.match(modelCfg, /<part id="1"/);
    assert.match(modelCfg, /<part id="2"/);
    const slic3rModel = await out.file("Metadata/Slic3r_PE_model.config").async("string");
    assert.match(slic3rModel, /<volume firstid="0" lastid="0">/);
    assert.match(slic3rModel, /<volume firstid="1" lastid="1">/);
    const plates = sanitizer.parsePlates(modelCfg);
    assert.equal(plates.length, 1);
    assert.equal(plates[0].instances.length, 1);
  });

  test("preserves multiple plates and remaps flattened object ids", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
  <object id="2" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
  <object id="4" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 90 90 1" printable="1"/>
  <item objectid="4" transform="1 0 0 0 1 0 0 0 1 306 90 1" printable="1"/>
 </build>
</model>`,
    );
    zip.file("3D/Objects/object_1.model", meshObjectXml());
    zip.file(
      "Metadata/model_settings.config",
      `<?xml version="1.0"?>
<config>
  <object id="2">
    <metadata key="name" value="ChipA"/>
    <metadata key="extruder" value="1"/>
  </object>
  <object id="4">
    <metadata key="name" value="ChipB"/>
    <metadata key="extruder" value="2"/>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance>
      <metadata key="object_id" value="2"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="10"/>
    </model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <model_instance>
      <metadata key="object_id" value="4"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="11"/>
    </model_instance>
  </plate>
</config>`,
    );
    const result = await sanitizeBytes(await zip.generateAsync({ type: "uint8array" }));
    const out = await loadOutput(result);
    const xml = await out.file("3D/3dmodel.model").async("string");
    const itemIds = [...xml.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1]);
    assert.equal(itemIds.length, 2);
    assert.notEqual(itemIds[0], itemIds[1]);
    const modelCfg = await out.file("Metadata/model_settings.config").async("string");
    const plates = sanitizer.parsePlates(modelCfg);
    assert.equal(plates.length, 2);
    assert.equal(plates[0].instances[0].objectId, itemIds[0]);
    assert.equal(plates[1].instances[0].objectId, itemIds[1]);
    assert.match(modelCfg, /<assemble>/);
    assert.equal(result.report.plates, 2);
  });

  test("assigns every leftover object to a plate when the source has no plate list", async () => {
    const result = await sanitizeBytes(await makeBambuZip());
    const out = await loadOutput(result);
    const modelCfg = await out.file("Metadata/model_settings.config").async("string");
    const plates = sanitizer.parsePlates(modelCfg);
    assert.equal(plates.length, 1);
    assert.ok(plates[0].instances.length >= 1);
  });

  test("extractPreviewMeshes returns colored parts for source and sanitized", async () => {
    const bytes = await makeBambuZip();
    const source = await sanitizer.extractPreviewMeshes(JSZip, bytes);
    assert.ok(source.meshes.length >= 1);
    assert.ok(source.meshes[0].positions.length >= 9);
    assert.equal(source.meshes[0].positions.length, source.meshes[0].colors.length);
    const result = await sanitizeBytes(bytes);
    const sanitized = await sanitizer.extractPreviewMeshes(JSZip, result.bytes);
    assert.equal(sanitized.meshes.length, source.meshes.length);
    assert.equal(sanitized.triangleCount, source.triangleCount);
  });
});

describe("real Bambu Studio 3MF", () => {
  test("Knafs_Yuti_Scales flattens, keeps paint and designer settings", async (t) => {
    if (!fs.existsSync(SAMPLE_BAMBU)) {
      t.skip("sample 3MF not on disk");
      return;
    }
    const input = fs.readFileSync(SAMPLE_BAMBU);
    const source = await JSZip.loadAsync(input);
    const srcObject = await source.file("3D/Objects/object_1.model").async("string");
    const srcVerts = (srcObject.match(/<vertex\b/g) || []).length;
    const srcTris = (srcObject.match(/<triangle\b/g) || []).length;
    const srcPaint = (srcObject.match(/paint_color="/g) || []).length;

    const result = await sanitizer.sanitize3mf(JSZip, input);
    const out = await JSZip.loadAsync(result.bytes);
    const xml = await out.file("3D/3dmodel.model").async("string");

    assert.equal(!!out.file("3D/Objects/object_1.model"), false);
    assert.doesNotMatch(xml, /requiredextensions/);
    assert.doesNotMatch(xml, /p:path=/);
    assert.equal(result.report.vertices, srcVerts);
    assert.equal(result.report.triangles, srcTris);
    assert.equal(result.report.paintColors, srcPaint);
    assert.match(xml, /paint_color="/);
    assert.match(xml, /slic3rpe:mmu_segmentation="/);
    assert.match(xml, /<basematerials /);
    assert.match(xml, /p1="4"/);

    const slic3r = await out.file("Metadata/Slic3r_PE.config").async("string");
    assert.match(slic3r, /; layer_height = 0.2/);
    assert.match(slic3r, /; perimeters = 2/);
    assert.match(slic3r, /; extrusion_width = 0.42/);
    assert.match(slic3r, /; fill_density = 15%/);
    assert.match(slic3r, /; filament_colour = #FFFFFF;#161616;#C52C18;#0085D5;#A0A0A0/);
    assert.match(slic3r, /; extruder_colour = #FFFFFF;#161616;#C52C18;#0085D5;#A0A0A0/);

    const project = JSON.parse(await out.file("Metadata/project_settings.config").async("string"));
    assert.equal(project.wall_loops, "2");
    assert.equal(project.line_width, "0.42");
    assert.equal(project.printer_model, undefined);
    assert.equal(project.filament_settings_id, undefined);
    assert.ok(Array.isArray(project.filament_colour));
    assert.equal(project.filament_colour.length, 5);
    assert.deepEqual(project.extruder_colour, project.filament_colour);
  });

  test("K2 MakerChip keeps each part's filament instead of one gray object", async (t) => {
    if (!fs.existsSync(SAMPLE_MAKERCHIP)) {
      t.skip("sample 3MF not on disk");
      return;
    }
    const result = await sanitizer.sanitize3mf(JSZip, fs.readFileSync(SAMPLE_MAKERCHIP));
    const out = await JSZip.loadAsync(result.bytes);
    const xml = await out.file("3D/3dmodel.model").async("string");
    const items = xml.match(/<item\b/g) || [];
    assert.equal(items.length, 1);
    assert.match(xml, /p1="0"/);
    assert.match(xml, /p1="1"/);
    assert.match(xml, /p1="2"/);
    assert.match(xml, /p1="3"/);
    assert.match(xml, /paint_color="4"/);
    assert.match(xml, /paint_color="8"/);
    assert.match(xml, /paint_color="0C"/);
    assert.match(xml, /paint_color="1C"/);
    const modelCfg = await out.file("Metadata/model_settings.config").async("string");
    assert.match(modelCfg, /Background Circle/);
    assert.match(modelCfg, /K2DesignLab_QRCode/);
    assert.match(modelCfg, /<part id="5"/);
    const slic3rModel = await out.file("Metadata/Slic3r_PE_model.config").async("string");
    assert.match(slic3rModel, /<volume firstid=/);
    assert.match(slic3rModel, /key="extruder" value="4"/);
    const project = JSON.parse(await out.file("Metadata/project_settings.config").async("string"));
    assert.deepEqual(project.filament_colour, ["#FBFCFF", "#F2910B", "#FFFF0A", "#000000"]);
    assert.deepEqual(project.extruder_colour, project.filament_colour);
  });
});
