import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { adaptFile, formatOfZip, planFor } from "./run";

const MODEL_NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

async function makerworldProject(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "3D/3dmodel.model",
    `<?xml version="1.0"?>
<model unit="millimeter" ${MODEL_NS}>
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <resources>
  <object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
 </resources>
 <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 10 0" printable="1"/></build>
</model>`,
  );
  zip.file(
    "3D/Objects/object_1.model",
    `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2" paint_color="8"/></triangles>
  </mesh></object>
 </resources>
 <build/>
</model>`,
  );
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify({
      wall_loops: "3",
      filament_colour: ["#FF0000", "#00FF00"],
      ensure_vertical_shell_thickness: "enabled",
    }),
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("what Grab makes of a MakerWorld 3MF", () => {
  it("reads it as a Bambu Studio project", async () => {
    const format = await formatOfZip(await JSZip.loadAsync(await makerworldProject()));
    expect(format).toMatchObject({ kind: "bambu", app: "BambuStudio", dialect: "bambu", filaments: 2 });
  });

  it("plans the copy the instance's slicer gets, or PrusaSlicer's without one", async () => {
    const format = await formatOfZip(await JSZip.loadAsync(await makerworldProject()));
    expect(planFor(format, null)).toEqual({ output: "prusa" });
    expect(planFor(format, "other")).toEqual({ output: "prusa" });
    expect(planFor(format, "cura")).toEqual({ output: "cura" });
    expect(planFor(format, "bambustudio")).toBeNull();
    expect(planFor(format, "snapmaker-orca")).toMatchObject({ output: "bambu", dialect: "orca" });
  });

  it("makes the copy, or hands the file back when the slicer needs none", async () => {
    const input = await makerworldProject();
    const prusa = await adaptFile(input, "prusaslicer");
    expect(prusa.output).toBe("prusa");
    const out = await JSZip.loadAsync(prusa.bytes);
    expect(out.file("Metadata/project_settings.config")).toBeNull();
    expect(await out.file("3D/3dmodel.model")!.async("string")).toMatch(/slic3rpe:mmu_segmentation="8"/);

    const same = await adaptFile(input, "bambustudio");
    expect(same.output).toBeNull();
    expect(same.bytes).toBe(input);
  });
});
