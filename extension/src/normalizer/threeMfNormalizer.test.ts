import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { normalizeTargetFor, normalizedFilename } from "../shared/slicers";
import {
  mapObjectShellSettings,
  markAsBambuProject,
  moveWipeTower,
  normalize3mf,
  recenterOnOrcaBed,
} from "./threeMfNormalizer";

const NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

const ROOT = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" ${NS}>
 <metadata name="Application">BambuStudio-02.07.01.57</metadata>
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

const MESH = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" ${NS}>
 <resources>
  <object id="1" p:UUID="aaaa" type="other">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="1" y="0" z="0"/>
     <vertex x="0" y="1" z="0"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" paint_color="4"/>
    </triangles>
   </mesh>
  </object>
 </resources>
</model>
`;

const SETTINGS = {
  wall_loops: "3",
  layer_height: "0.15",
  filament_colour: ["#FFFFFF"],
  printer_model: "Bambu Lab X1C",
  machine_start_gcode: "G28",
  printable_height: "250",
  nozzle_diameter: ["0.4", "0.4"],
  print_settings_id: "0.20mm Standard @BBL X1C",
  printer_settings_id: "Bambu Lab X1C 0.4 nozzle",
  filament_type: ["PLA"],
  filament_settings_id: ["Bambu PLA Basic @BBL X1C"],
};

async function bambuZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", ROOT);
  zip.file("3D/Objects/object_1.model", MESH);
  zip.file("Metadata/project_settings.config", JSON.stringify(SETTINGS));
  zip.file("Metadata/plate_1.gcode", "G1 X0");
  zip.file("Metadata/slice_info.config", "<config/>");
  zip.file("Metadata/custom_gcode_per_layer.xml", "<custom_gcodes_per_layer/>");
  return zip.generateAsync({ type: "uint8array" });
}

async function read(bytes: Uint8Array, name: string): Promise<string> {
  return (await (await JSZip.loadAsync(bytes)).file(name)!.async("string")) as string;
}

const item = (id: number, x: number, y: number) =>
  `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} 5" printable="1"/>`;
const plate = (id: number, objectId: number) => ({
  id: String(id),
  name: "",
  instances: [{ objectId: String(objectId), instanceId: 0, identifyId: "" }],
});

async function filamentPresets(extra: Record<string, unknown>): Promise<unknown> {
  const zip = await JSZip.loadAsync(await bambuZip());
  const settings = { ...SETTINGS, ...extra };
  zip.file("Metadata/project_settings.config", JSON.stringify(settings));
  const { bytes } = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
  return JSON.parse(await read(bytes, "Metadata/project_settings.config")).filament_settings_id;
}

async function orcaProject(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
  const zip = await JSZip.loadAsync(await bambuZip());
  zip.file("Metadata/project_settings.config", JSON.stringify(settings));
  const { bytes } = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
  return JSON.parse(await read(bytes, "Metadata/project_settings.config"));
}

describe("normalize3mf for an Orca fork", () => {
  it("keeps the production layout and painting, and drops only G-code and the printer profile", async () => {
    const { bytes } = await normalize3mf(await bambuZip(), "orca");
    const out = await JSZip.loadAsync(bytes);
    expect(out.file("3D/Objects/object_1.model")).not.toBeNull();
    expect(await read(bytes, "3D/Objects/object_1.model")).toContain('paint_color="4"');
    expect(await read(bytes, "3D/3dmodel.model")).toContain('p:path="/3D/Objects/object_1.model"');
    expect(out.file("Metadata/plate_1.gcode")).toBeNull();
    expect(out.file("Metadata/slice_info.config")).toBeNull();
    expect(out.file("Metadata/custom_gcode_per_layer.xml")).toBeNull();
    const project = JSON.parse(await read(bytes, "Metadata/project_settings.config"));
    expect(project.wall_loops).toBe("3");
    expect(project.printer_model).toBeUndefined();
    expect(project.machine_start_gcode).toBeUndefined();
    // Snapmaker Orca crashes without these keys: kept, but naming no preset of the designer's printer.
    // The base the designer started from (0.20mm in the name), not the preset nearest their 0.15 layer height.
    expect(project.print_settings_id).toBe("0.20mm Standard @Snapmaker U1 (0.4 nozzle)");
    expect(project.printer_settings_id).toBe("Snapmaker U1 (0.4 nozzle)");
    expect(project.filament_settings_id).toEqual(["Bambu PLA Basic @BBL X1C"]);
    expect(project.printable_height).toBe("270");
    expect(project.use_relative_e_distances).toBe("0");
    expect(project.printable_area).toEqual(["0.5x1", "270.5x1", "270.5x271", "0.5x271"]);
    // One nozzle, not one per designer extruder (that would show a dual-nozzle printer).
    expect(project.nozzle_diameter).toEqual(["0.4"]);
  });

  it("falls back to the preset nearest the layer height when the designer's preset has no height", async () => {
    const zip = await JSZip.loadAsync(await bambuZip());
    const settings = { ...SETTINGS, print_settings_id: "My own preset", layer_height: "0.275" };
    zip.file("Metadata/project_settings.config", JSON.stringify(settings));
    const { bytes } = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
    const project = JSON.parse(await read(bytes, "Metadata/project_settings.config"));
    expect(project.print_settings_id).toBe("0.28mm Standard @Snapmaker U1 (0.4 nozzle)");
  });

  it("takes the designer's nozzle and a process preset the U1 has for it", async () => {
    const zip = await JSZip.loadAsync(await bambuZip());
    const settings = {
      ...SETTINGS,
      nozzle_diameter: ["0.6"],
      print_settings_id: "0.30mm Standard @BBL H2C 0.6 nozzle",
    };
    zip.file("Metadata/project_settings.config", JSON.stringify(settings));
    const { bytes } = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
    const project = JSON.parse(await read(bytes, "Metadata/project_settings.config"));
    expect(project.printer_settings_id).toBe("Snapmaker U1 (0.6 nozzle)");
    expect(project.print_settings_id).toBe("0.30mm Standard @Snapmaker U1 (0.6 nozzle)");
    expect(project.nozzle_diameter).toEqual(["0.6"]);
  });

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

  it("takes nozzle, process preset and filament name from a legacy project's nested settings", async () => {
    const project = await orcaProject({
      filament_colour: ["#FFFFFF"],
      process_settings: {
        "1": {
          nozzle_diameter: ["0.6"],
          print_settings_id: "0.24mm Standard @BBL X1C",
          filament_settings_id: ["My PETG"],
        },
      },
    });
    expect(project.nozzle_diameter).toEqual(["0.6"]);
    expect(project.printer_settings_id).toBe("Snapmaker U1 (0.6 nozzle)");
    expect(project.print_settings_id).toBe("0.24mm Standard @Snapmaker U1 (0.6 nozzle)");
    expect(project.filament_settings_id).toEqual(["My PETG"]);
  });

  it("gives a flat project the same result as before, and falls back without nozzle or names", async () => {
    const flat = await orcaProject({
      nozzle_diameter: ["0.6"],
      print_settings_id: "0.24mm Standard @BBL X1C",
      filament_settings_id: ["My PETG"],
    });
    expect(flat.printer_settings_id).toBe("Snapmaker U1 (0.6 nozzle)");
    expect(flat.print_settings_id).toBe("0.24mm Standard @Snapmaker U1 (0.6 nozzle)");
    expect(flat.filament_settings_id).toEqual(["My PETG"]);
    // A process_settings object without "1" is not nested: nothing to resolve, defaults apply.
    const empty = await orcaProject({ process_settings: {}, filament_colour: ["#FFFFFF"] });
    expect(empty.printer_settings_id).toBe("Snapmaker U1 (0.4 nozzle)");
    expect(empty.print_settings_id).toBe("0.20mm Standard @Snapmaker U1 (0.4 nozzle)");
    expect(empty.filament_settings_id).toBe("Generic");
  });

  it("moves each plate's items from the designer's bed to the middle of a 270 mm bed", () => {
    const bed = { width: 330, depth: 320, centerX: 165, centerY: 160 };
    const xml = `<model><build>${item(1, 165, 160)}${item(2, 561, 160)}${item(3, 165, -224)}${item(9, 7, 7)}</build></model>`;
    const moved = recenterOnOrcaBed(xml, [plate(1, 1), plate(2, 2), plate(3, 3)], bed)!;
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 135 135 5"');
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 459 135 5"');
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 135 -189 5"');
    expect(moved).toContain('transform="1 0 0 0 1 0 0 0 1 7 7 5"');
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

  it("maps per-object Bambu shell values in model_settings.config", () => {
    const xml =
      '<metadata key="ensure_vertical_shell_thickness" value="partial"/><metadata key="ensure_vertical_shell_thickness" value="enabled"/>';
    const out = mapObjectShellSettings(xml)!;
    expect(out).toContain('value="ensure_moderate"');
    expect(out).toContain('value="ensure_all"');
    expect(mapObjectShellSettings("<x/>")).toBeNull();
  });

  it("flat (the default) still flattens the production layout", async () => {
    const { bytes } = await normalize3mf(await bambuZip());
    expect(await read(bytes, "3D/3dmodel.model")).not.toContain("p:path");
  });

  it("sets the Application tag to a Bambu Studio version Snapmaker Orca accepts", () => {
    const tag = '<metadata name="Application">BambuStudio-01.10.01.50</metadata>';
    // MakerWorld files carry a newer Bambu Studio than Snapmaker Orca, which refuses those.
    expect(markAsBambuProject(ROOT)).toContain(tag);
    expect(markAsBambuProject(ROOT.replace("BambuStudio-02.07.01.57", "Snapmaker_Orca-2.4.1"))).toContain(tag);
    expect(markAsBambuProject(ROOT.replace("BambuStudio-02.07.01.57", "OrcaSlicer-2.3.0"))).toContain(tag);
    expect(markAsBambuProject(ROOT.replace("BambuStudio-02.07.01.57", "BambuStudio-01.10.01.50"))).toBeNull();
    const untagged = ROOT.replace(/ <metadata name="Application">[^<]*<\/metadata>\n/, "");
    expect(markAsBambuProject(untagged)).toContain(tag);
  });

  it("falls back to the original settings file when it isn't JSON", async () => {
    const zip = await JSZip.loadAsync(await bambuZip());
    zip.file("Metadata/project_settings.config", "not json");
    const { bytes } = await normalize3mf(await zip.generateAsync({ type: "uint8array" }), "orca");
    expect(await read(bytes, "Metadata/project_settings.config")).toBe("not json");
  });
});

describe("normalizeTargetFor", () => {
  it("gives only Snapmaker Orca the Orca target", () => {
    expect(normalizeTargetFor("snapmaker-orca")).toBe("orca");
    for (const id of ["elegooslicer", "crealityprintlink", "prusaslicer", "cura", "", null, undefined])
      expect(normalizeTargetFor(id)).toBe("flat");
  });
});

describe("normalizedFilename", () => {
  it("names the Orca-fork copy -orca and the others -normalized", () => {
    expect(normalizedFilename("Benchy.3mf", "orca")).toBe("Benchy-orca.3mf");
    expect(normalizedFilename("Benchy.3MF", "flat")).toBe("Benchy-normalized.3mf");
    expect(normalizedFilename("Benchy.3mf")).toBe("Benchy-normalized.3mf");
  });
});
