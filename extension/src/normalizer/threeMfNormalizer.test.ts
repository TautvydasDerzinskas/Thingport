import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { normalizeTargetFor } from "../shared/slicers";
import { markAsBambuProject, normalize3mf } from "./threeMfNormalizer";

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
  });

  it("flat (the default) still flattens the production layout", async () => {
    const { bytes } = await normalize3mf(await bambuZip());
    expect(await read(bytes, "3D/3dmodel.model")).not.toContain("p:path");
  });

  it("marks a foreign Application tag as Bambu Studio and leaves Bambu and Snapmaker Orca ones", () => {
    expect(markAsBambuProject(ROOT)).toBeNull();
    expect(markAsBambuProject(ROOT.replace("BambuStudio-02.07.01.57", "Snapmaker_Orca-2.2.0"))).toBeNull();
    expect(markAsBambuProject(ROOT.replace("BambuStudio-02.07.01.57", "OrcaSlicer-2.3.0"))).toContain(
      '<metadata name="Application">BambuStudio-2.3.0</metadata>',
    );
    const untagged = ROOT.replace(/ <metadata name="Application">[^<]*<\/metadata>\n/, "");
    expect(markAsBambuProject(untagged)).toContain('name="Application">BambuStudio-02.00.00.00<');
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
