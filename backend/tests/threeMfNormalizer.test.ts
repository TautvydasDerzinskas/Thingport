import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  decodePaintState,
  encodePaintState,
  extractBambuSettings,
  markAsBambuProject,
  mapSettingsToSlic3r,
  parsePlates,
  recenterOnOrcaBed,
  moveWipeTower,
  normalize3mf,
  normalizeProjectSettings,
  stateToMaterialIndex,
} from "../src/services/threeMfNormalizer";

// Pure: no database. The cache test points storage at a temp dir before loading config.

const MODEL_NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

const SINGLE_COMPONENT_ROOT = `  <object id="2" p:UUID="root" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`;

function modelXml(body: string, head = ' <metadata name="Title">Test Cube</metadata>'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${MODEL_NS}>
${head}
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
     <triangle v1="0" v2="1" v3="2" paint_color="4"/>
     <triangle v1="1" v2="3" v3="2" paint_color="8"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>
`;

async function makeBambuZip(overrides: { rootXml?: string } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", overrides.rootXml ?? modelXml(SINGLE_COMPONENT_ROOT));
  zip.file("3D/Objects/object_1.model", MESH_OBJECT);
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships/>');
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify({
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
      printable_height: "180",
      nozzle_diameter: ["0.4", "0.4"],
      print_settings_id: "0.20mm Standard @BBL A1M",
      printer_settings_id: "Bambu Lab A1 mini 0.4 nozzle",
    }),
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

async function normalizeZip(zip: JSZip) {
  return normalize3mf(await zip.generateAsync({ type: "uint8array" }));
}

async function readOut(bytes: Uint8Array, name: string): Promise<string> {
  const file = (await JSZip.loadAsync(bytes)).file(name);
  if (!file) throw new Error(`missing ${name}`);
  return file.async("string");
}

describe("extractBambuSettings", () => {
  it("reads flat project settings", () => {
    const flat = extractBambuSettings({ wall_loops: "4", layer_height: "0.16" });
    expect(flat.wall_loops).toBe("4");
    expect(flat.process_settings).toBeUndefined();
  });

  it("merges legacy nested process_settings.1", () => {
    expect(
      extractBambuSettings({ printer_model: "X1", process_settings: { "1": { wall_loops: "6" } } }).wall_loops,
    ).toBe("6");
  });
});

describe("mapSettingsToSlic3r", () => {
  it("maps walls, layer height, line widths and infill", () => {
    const mapped = mapSettingsToSlic3r({
      layer_height: "0.2",
      wall_loops: "3",
      line_width: "0.42",
      inner_wall_line_width: "0.45",
      outer_wall_line_width: "0.42",
      sparse_infill_density: "15%",
      sparse_infill_pattern: "crosshatch",
      enable_support: "1",
    });
    expect(mapped).toMatchObject({
      layer_height: "0.2",
      perimeters: "3",
      extrusion_width: "0.42",
      perimeter_extrusion_width: "0.45",
      external_perimeter_extrusion_width: "0.42",
      fill_density: "15%",
      fill_pattern: "grid",
      support_material: "1",
    });
  });

  it("keeps filament arrays and widens extruder_colour to the full palette", () => {
    const mapped = mapSettingsToSlic3r({
      filament_colour: ["#FFFFFF", "#161616", "#C52C18"],
      filament_type: ["PLA", "PETG", "PLA"],
      nozzle_temperature: ["210", "240", "210"],
      extruder_colour: ["#018001"],
    });
    expect(mapped.filament_type).toEqual(["PLA", "PETG", "PLA"]);
    expect(mapped.temperature).toEqual(["210", "240", "210"]);
    expect(mapped.extruder_colour).toEqual(["#FFFFFF", "#161616", "#C52C18"]);
  });
});

describe("normalizeProjectSettings", () => {
  it("keeps designer process settings and strips printer, machine and sentinel values", () => {
    const cleaned = normalizeProjectSettings({
      wall_loops: "3",
      filament_colour: ["#FFFFFF", "#C52C18"],
      extruder_colour: ["#018001"],
      filament_settings_id: ["Generic PLA @BBL A1M"],
      printer_model: "Bambu Lab A1 mini",
      machine_start_gcode: "M104",
      use_relative_e_distances: "1",
      raft_first_layer_expansion: "-1",
      tree_support_wall_count: -1,
      filament_retraction_length: ["nil", "nil"],
      ensure_vertical_shell_thickness: "enabled",
      wall_filament: "0",
    });
    expect(cleaned).toEqual({
      wall_loops: "3",
      filament_colour: ["#FFFFFF", "#C52C18"],
      extruder_colour: ["#FFFFFF", "#C52C18"],
      ensure_vertical_shell_thickness: "ensure_all",
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

describe("normalize3mf", () => {
  it("flattens the production extension into one core model", async () => {
    const result = await normalize3mf(await makeBambuZip());
    const out = await JSZip.loadAsync(result.bytes);
    expect(out.file("3D/Objects/object_1.model")).toBeNull();
    const xml = await readOut(result.bytes, "3D/3dmodel.model");
    expect(xml).toMatch(/<vertex /);
    expect(xml).not.toMatch(/requiredextensions|p:path|xmlns:p=|type="other"/);
    expect(xml).toMatch(/<metadata name="Application">Thingport<\/metadata>/);
    expect(result.report.flattened).toBe(true);
  });

  it("keeps painted faces and filament colors", async () => {
    const result = await normalize3mf(await makeBambuZip());
    const xml = await readOut(result.bytes, "3D/3dmodel.model");
    expect(xml).toMatch(/paint_color="4"/);
    expect(xml).toMatch(/slic3rpe:mmu_segmentation="8"/);
    expect(xml).toMatch(/p1="0"/);
    expect(xml).toMatch(/p1="1"/);
    expect(xml).toMatch(/displaycolor="#FFFFFFFF"/);
    expect(xml).toMatch(/displaycolor="#C52C18FF"/);
    expect(result.report).toMatchObject({ paintColors: 2, triangles: 2, vertices: 4 });
  });

  it("writes Slic3r settings alongside, not inside, existing metadata", async () => {
    const result = await normalize3mf(await makeBambuZip());
    const xml = await readOut(result.bytes, "3D/3dmodel.model");
    expect(xml).toMatch(/<metadata name="Title">Test Cube<\/metadata>/);
    expect(xml).toMatch(/<metadata name="slic3r:perimeters">3<\/metadata>/);
    const slic3r = await readOut(result.bytes, "Metadata/Slic3r_PE.config");
    expect(slic3r).toMatch(/; perimeters = 3/);
    expect(slic3r).toMatch(/; fill_density = 15%/);
    expect(slic3r).toMatch(/; extruder_colour = #FFFFFF;#C52C18/);
  });

  it("closes an unclosed empty Copyright tag", async () => {
    const head =
      ' <metadata name="Title">Broly</metadata>\n <metadata name="Copyright">\n <metadata name="Designer">MakerWorld</metadata>';
    const result = await normalize3mf(await makeBambuZip({ rootXml: modelXml(SINGLE_COMPONENT_ROOT, head) }));
    const xml = await readOut(result.bytes, "3D/3dmodel.model");
    expect(xml).toMatch(/<metadata name="Copyright" \/>/);
    expect(xml).toMatch(/<metadata name="Designer">MakerWorld<\/metadata>/);
    expect(xml).not.toMatch(/<metadata name="Copyright">/);
  });

  it("strips G-code, slice info and the printer profile", async () => {
    const result = await normalize3mf(await makeBambuZip());
    const out = await JSZip.loadAsync(result.bytes);
    expect(out.file("Metadata/plate_1.gcode")).toBeNull();
    expect(out.file("Metadata/slice_info.config")).toBeNull();
    expect(out.file("3D/_rels/3dmodel.model.rels")).toBeNull();
    const project = JSON.parse(await readOut(result.bytes, "Metadata/project_settings.config"));
    expect(project.wall_loops).toBe("3");
    expect(project.printer_model).toBeUndefined();
    expect(project.filament_settings_id).toBeUndefined();
    expect(project.machine_start_gcode).toBeUndefined();
  });

  it("rejects archives without a model", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "no model");
    await expect(normalizeZip(zip)).rejects.toThrow(/No valid 3D model/);
  });

  it("still normalizes an already-flat 3MF", async () => {
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
    const result = await normalizeZip(zip);
    expect(result.report).toMatchObject({ triangles: 1, flattened: false });
    expect(await readOut(result.bytes, "3D/3dmodel.model")).toMatch(/pid="/);
  });

  it("merges a multi-part assembly into one object that keeps each part's filament", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0"?>
<model unit="millimeter" ${MODEL_NS}>
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
      JSON.stringify({ filament_colour: ["#FBFCFF", "#F2910B", "#000000"], filament_type: ["PLA", "PLA", "PLA"] }),
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
    const result = await normalizeZip(zip);
    const xml = await readOut(result.bytes, "3D/3dmodel.model");
    expect(xml.match(/<item\b/g)).toHaveLength(1);
    expect(xml).toMatch(/p1="2"/);
    expect(xml).toMatch(/p1="0"/);
    expect(xml).toMatch(/paint_color="0C"/);
    expect(xml).toMatch(/paint_color="4"/);
    const modelCfg = await readOut(result.bytes, "Metadata/model_settings.config");
    expect(modelCfg).toMatch(/value="Background"/);
    expect(modelCfg).toMatch(/value="QR"/);
    const slic3rModel = await readOut(result.bytes, "Metadata/Slic3r_PE_model.config");
    expect(slic3rModel).toMatch(/<volume firstid="0" lastid="0">/);
    expect(slic3rModel).toMatch(/<volume firstid="1" lastid="1">/);
    expect(parsePlates(modelCfg)[0].instances).toHaveLength(1);
  });

  it("keeps multiple plates, remapped to the flattened object ids", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0"?>
<model unit="millimeter" ${MODEL_NS}>
 <resources>
  <object id="2" type="model">
   <components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components>
  </object>
  <object id="4" type="model">
   <components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 90 90 1" printable="1"/>
  <item objectid="4" transform="1 0 0 0 1 0 0 0 1 306 90 1" printable="1"/>
 </build>
</model>`,
    );
    zip.file("3D/Objects/object_1.model", MESH_OBJECT);
    zip.file(
      "Metadata/model_settings.config",
      `<?xml version="1.0"?>
<config>
  <object id="2"><metadata key="name" value="ChipA"/><metadata key="extruder" value="1"/></object>
  <object id="4"><metadata key="name" value="ChipB"/><metadata key="extruder" value="2"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="10"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <model_instance><metadata key="object_id" value="4"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="11"/></model_instance>
  </plate>
</config>`,
    );
    const result = await normalizeZip(zip);
    const xml = await readOut(result.bytes, "3D/3dmodel.model");
    const itemIds = [...xml.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1]);
    expect(itemIds).toHaveLength(2);
    expect(itemIds[0]).not.toBe(itemIds[1]);
    const modelCfg = await readOut(result.bytes, "Metadata/model_settings.config");
    const plates = parsePlates(modelCfg);
    expect(plates.map((p) => p.instances[0].objectId)).toEqual(itemIds);
    expect(modelCfg).toMatch(/<assemble>/);
    expect(result.report.plates).toBe(2);
  });
});

describe("normalize3mf for an Orca fork", () => {
  it("keeps the production layout, parts and painting, and drops only G-code and the printer profile", async () => {
    const result = await normalize3mf(await makeBambuZip(), "orca");
    const out = await JSZip.loadAsync(result.bytes);
    expect(out.file("3D/Objects/object_1.model")).not.toBeNull();
    expect(await readOut(result.bytes, "3D/Objects/object_1.model")).toContain('paint_color="4"');
    expect(await readOut(result.bytes, "3D/3dmodel.model")).toContain('p:path="/3D/Objects/object_1.model"');
    expect(await readOut(result.bytes, "Metadata/model_settings.config")).toContain("DesignerPart");
    expect(out.file("3D/_rels/3dmodel.model.rels")).not.toBeNull();
    expect(out.file("Metadata/plate_1.gcode")).toBeNull();
    expect(out.file("Metadata/slice_info.config")).toBeNull();
    expect(out.file("Metadata/Slic3r_PE.config")).toBeNull();
    expect(out.file("Metadata/Slic3r_PE_model.config")).toBeNull();
    const project = JSON.parse(await readOut(result.bytes, "Metadata/project_settings.config"));
    expect(project.wall_loops).toBe("3");
    expect(project.filament_colour).toEqual(["#FFFFFF", "#C52C18"]);
    expect(project.printer_model).toBeUndefined();
    expect(project.machine_start_gcode).toBeUndefined();
    // Snapmaker Orca crashes without these keys: kept, but naming no preset of the designer's printer.
    expect(project.print_settings_id).toBe("0.20mm Standard @Snapmaker U1 (0.4 nozzle)");
    expect(project.printer_settings_id).toBe("Snapmaker U1 (0.4 nozzle)");
    expect(project.filament_settings_id).toEqual(["Generic PLA @BBL A1M", "Generic PLA @BBL A1M"]);
    expect(project.printable_height).toBe("270");
    expect(project.use_relative_e_distances).toBe("0");
    expect(project.printable_area).toEqual(["0.5x1", "270.5x1", "270.5x271", "0.5x271"]);
    // One nozzle, not one per designer extruder (that would show a dual-nozzle printer).
    expect(project.nozzle_diameter).toEqual(["0.4"]);
  });

  async function filamentPresets(extra: Record<string, unknown>): Promise<unknown> {
    const zip = await JSZip.loadAsync(await makeBambuZip());
    const settings = { nozzle_diameter: ["0.4"], filament_type: ["PLA"], filament_settings_id: ["x"], ...extra };
    zip.file("Metadata/project_settings.config", JSON.stringify(settings));
    const { bytes } = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
    return JSON.parse(await readOut(bytes, "Metadata/project_settings.config")).filament_settings_id;
  }

  it("keeps the designer's filament preset name per slot, whatever the material or nozzle", async () => {
    expect(
      await filamentPresets({
        filament_type: ["PLA", "PETG", "TPU-AMS", "PA"],
        filament_settings_id: ["Generic PLA @BBL H2C", "My PETG", "My TPU", "My PA"],
        nozzle_diameter: ["0.6"],
      }),
    ).toEqual(["Generic PLA @BBL H2C", "My PETG", "My TPU", "My PA"]);
    // A name that is also a U1 preset stays as it is.
    expect(await filamentPresets({ filament_settings_id: ["Snapmaker PLA Basic @U1"] })).toEqual([
      "Snapmaker PLA Basic @U1",
    ]);
  });

  it('names "Generic" for an empty name, and handles scalar values', async () => {
    // A blank name becomes "Generic" because Orca crashes without one.
    expect(await filamentPresets({ filament_type: [""], filament_settings_id: [" "] })).toEqual(["Generic"]);
    expect(await filamentPresets({ filament_type: ["PLA"], filament_settings_id: [] })).toEqual([]);
    expect(await filamentPresets({ filament_type: "ASA", filament_settings_id: "Mine" })).toBe("Mine");
    expect(await filamentPresets({ filament_settings_id: "" })).toBe("Generic");
  });

  it("keeps one filament name per designer slot", async () => {
    expect(
      await filamentPresets({ filament_type: ["PLA", "PLA", "PLA"], filament_settings_id: ["a", "b", "c"] }),
    ).toHaveLength(3);
  });

  it("moves each plate's items from the designer's bed to the middle of a 270 mm bed", () => {
    const bed = { width: 330, depth: 320, centerX: 165, centerY: 160 };
    const item = (id: number, x: number, y: number) =>
      `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} 5" printable="1"/>`;
    const xml = `<model><build>${item(1, 165, 160)}${item(2, 561, 160)}${item(3, 165, -224)}${item(9, 7, 7)}</build></model>`;
    const plate = (id: number, objectId: number) => ({
      id: String(id),
      name: "",
      instances: [{ objectId: String(objectId), instanceId: 0, identifyId: "" }],
    });
    const moved = recenterOnOrcaBed(xml, [plate(1, 1), plate(2, 2), plate(3, 3)], bed)!;
    // Plate 1 is the first column of the first row, plate 2 the second column, plate 3 the second row.
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 135 135 5"');
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 459 135 5"');
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 135 -189 5"');
    // An item on no plate keeps its place.
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 7 7 5"');
    // Nothing to do without a known bed, without plates, or when the bed is already 270 mm.
    expect(recenterOnOrcaBed(xml, [plate(1, 1)], null)).toBeNull();
    expect(recenterOnOrcaBed(xml, [], bed)).toBeNull();
    expect(recenterOnOrcaBed(xml, [plate(1, 1)], { width: 270, depth: 270, centerX: 135, centerY: 135 })).toBeNull();
  });

  it("moves the wipe tower of each plate from the designer's bed onto the 270 mm bed", () => {
    const original = {
      printable_area: ["0x0", "330x0", "330x320", "0x320"],
      prime_tower_width: "60",
      wipe_tower_x: ["40", "165", "-5"],
      wipe_tower_y: ["267.639", "250", "160"],
    };
    const cleaned: Record<string, unknown> = {};
    moveWipeTower(cleaned, original);
    // Shifted by (-30, -25), then kept inside the bed: a 60 mm tower with the default 5 mm brim and 2 mm slack
    // fits from 7 to 203.
    expect(cleaned.wipe_tower_x).toEqual(["10", "135", "7"]);
    expect(cleaned.wipe_tower_y).toEqual(["203", "203", "135"]);
    const untouched: Record<string, unknown> = {};
    moveWipeTower(untouched, { printable_area: original.printable_area });
    expect(untouched.wipe_tower_x).toBeUndefined();
  });

  it("keeps the wipe tower, brim and ribs on the bed whatever the tower settings say", () => {
    const base = {
      printable_area: ["0x0", "270x0", "270x270", "0x270"],
      wipe_tower_x: ["-20", "100", "400"],
      wipe_tower_y: ["0", "100", "400"],
    };
    const run = (extra: Record<string, unknown>): Record<string, unknown> => {
      const cleaned: Record<string, unknown> = {};
      moveWipeTower(cleaned, { ...base, ...extra });
      return cleaned;
    };
    // No width or brim: the U1 preset's 30 mm tower and 5 mm brim, so 7 mm to the near edge and 270 - 37 to the far one.
    expect(run({}).wipe_tower_x).toEqual(["7", "100", "233"]);
    expect(run({}).wipe_tower_y).toEqual(["7", "100", "233"]);
    // A width below the preset's 30 does not shrink it; a larger brim and rib extension widen the margins.
    expect(run({ prime_tower_width: "10" }).wipe_tower_x).toEqual(["7", "100", "233"]);
    expect(
      run({
        prime_tower_width: "40",
        prime_tower_brim_width: "8",
        wipe_tower_wall_type: "rib",
        wipe_tower_extra_rib_length: "8",
      }).wipe_tower_x,
    ).toEqual(["10", "100", "212"]);
    // Ribs only count for the rib wall type; list values (one per extruder) and junk widths are tolerated.
    expect(
      run({ prime_tower_width: ["40"], wipe_tower_wall_type: "rectangle", wipe_tower_extra_rib_length: "8" })
        .wipe_tower_x,
    ).toEqual(["7", "100", "223"]);
    expect(run({ prime_tower_width: "abc", prime_tower_brim_width: "-1" }).wipe_tower_x).toEqual(["7", "100", "233"]);
    // A tower larger than the bed has no room: it sits at the near margin instead of leaving the bed on the other side.
    expect(run({ prime_tower_width: "300" }).wipe_tower_x).toEqual(["7", "7", "7"]);
    // A position that is not a number is passed through.
    expect(run({ wipe_tower_x: ["x"] }).wipe_tower_x).toEqual(["x"]);
  });

  it("sets the Application tag to a Bambu Studio version Snapmaker Orca accepts", () => {
    const tag = '<metadata name="Application">BambuStudio-01.10.01.50</metadata>';
    const own = modelXml(SINGLE_COMPONENT_ROOT);
    // MakerWorld files carry a newer Bambu Studio than Snapmaker Orca, which refuses those.
    expect(markAsBambuProject(own)).toContain(tag);
    expect(markAsBambuProject(own.replace("BambuStudio-02.07.01.57", "Snapmaker_Orca-2.4.1"))).toContain(tag);
    expect(markAsBambuProject(own.replace("BambuStudio-02.07.01.57", "OrcaSlicer-2.3.0"))).toContain(tag);
    expect(markAsBambuProject(own.replace("BambuStudio-02.07.01.57", "BambuStudio-01.10.01.50"))).toBeNull();
    const withoutTag = own.replace(/ <metadata name="Application">[^<]*<\/metadata>\r?\n/, "");
    expect(withoutTag).not.toContain("Application");
    expect(markAsBambuProject(withoutTag)).toContain(tag);
  });

  it("falls back to the original settings file when it isn't JSON", async () => {
    const zip = await JSZip.loadAsync(await makeBambuZip());
    zip.file("Metadata/project_settings.config", "not json");
    const result = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
    expect(await readOut(result.bytes, "Metadata/project_settings.config")).toBe("not json");
  });
});

describe("normalized3mfFor", () => {
  it("normalizes in a worker, caches the copy and falls back to null for a broken file", async () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-normalize-"));
    process.env.FILE_STORAGE = storage;
    const { normalized3mfFor } = await import("../src/services/normalized3mfCache");

    const src = path.join(storage, "model.3mf");
    fs.writeFileSync(src, await makeBambuZip());
    const first = await normalized3mfFor("plate-a", src);
    expect(first).not.toBeNull();
    expect(await readOut(fs.readFileSync(first!), "3D/3dmodel.model")).toMatch(/Thingport/);
    const mtime = fs.statSync(first!).mtimeMs;
    expect(await normalized3mfFor("plate-a", src)).toBe(first);
    expect(fs.statSync(first!).mtimeMs).toBe(mtime);

    const broken = path.join(storage, "broken.3mf");
    fs.writeFileSync(broken, "not a zip");
    expect(await normalized3mfFor("plate-b", broken)).toBeNull();

    // The Orca copy is kept apart from the flat one for the same plate.
    const orca = await normalized3mfFor("plate-a", src, "orca");
    expect(orca).not.toBeNull();
    expect(orca).not.toBe(first);
    expect((await JSZip.loadAsync(fs.readFileSync(orca!))).file("3D/Objects/object_1.model")).not.toBeNull();
    expect(await readOut(fs.readFileSync(first!), "3D/3dmodel.model")).toMatch(/Thingport/);
    fs.rmSync(storage, { recursive: true, force: true });
  });
});
