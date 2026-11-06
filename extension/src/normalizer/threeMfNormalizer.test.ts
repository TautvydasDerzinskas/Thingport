import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { normalizeTargetFor } from "../shared/slicers";
import { markAsBambuProject, normalize3mf, recenterOnOrcaBed } from "./threeMfNormalizer";

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
  filament_colour: ["#FFFFFF"],
  printer_model: "Bambu Lab X1C",
  machine_start_gcode: "G28",
  printable_height: "250",
  nozzle_diameter: ["0.4", "0.4"],
  print_settings_id: "0.20mm Standard @BBL X1C",
  printer_settings_id: "Bambu Lab X1C 0.4 nozzle",
  filament_settings_id: ["Bambu PLA Basic @BBL X1C"],
};

async function bambuZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", ROOT);
  zip.file("3D/Objects/object_1.model", MESH);
  zip.file("Metadata/project_settings.config", JSON.stringify(SETTINGS));
  zip.file("Metadata/plate_1.gcode", "G1 X0");
  zip.file("Metadata/slice_info.config", "<config/>");
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

describe("normalize3mf for an Orca fork", () => {
  it("keeps the production layout and painting, and drops only G-code and the printer profile", async () => {
    const { bytes } = await normalize3mf(await bambuZip(), "orca");
    const out = await JSZip.loadAsync(bytes);
    expect(out.file("3D/Objects/object_1.model")).not.toBeNull();
    expect(await read(bytes, "3D/Objects/object_1.model")).toContain('paint_color="4"');
    expect(await read(bytes, "3D/3dmodel.model")).toContain('p:path="/3D/Objects/object_1.model"');
    expect(out.file("Metadata/plate_1.gcode")).toBeNull();
    expect(out.file("Metadata/slice_info.config")).toBeNull();
    const project = JSON.parse(await read(bytes, "Metadata/project_settings.config"));
    expect(project.wall_loops).toBe("3");
    expect(project.printer_model).toBeUndefined();
    expect(project.machine_start_gcode).toBeUndefined();
    // Snapmaker Orca crashes without these keys: kept, but naming no preset of the designer's printer.
    expect(project.print_settings_id).toBe("");
    expect(project.printer_settings_id).toBe("");
    expect(project.filament_settings_id).toEqual([""]);
    expect(project.printable_height).toBe("270");
    expect(project.use_relative_e_distances).toBe("0");
    expect(project.printable_area).toEqual(["0.5x1", "270.5x1", "270.5x271", "0.5x271"]);
    // One nozzle, not one per designer extruder (that would show a dual-nozzle printer).
    expect(project.nozzle_diameter).toEqual(["0.4"]);
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
