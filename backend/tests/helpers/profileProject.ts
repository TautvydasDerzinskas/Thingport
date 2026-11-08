import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

// A 1x1 PNG, as a plate's picture.
export const PLATE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** A print profile's project as Bambu Studio writes one: two plates, the first named, and when `sliced`, the first's
 *  slice (or both plates' with "all", only both plates' times with "times", or both plates' with a filament missing its
 *  weight on the first with "incomplete"). */
export async function profileProject(
  dir: string,
  name: string,
  sliced: "none" | "first" | "all" | "times" | "incomplete" = "first",
  { printer = "Bambu Lab X1 Carbon" }: { printer?: string } = {},
) {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", '<?xml version="1.0"?><model unit="millimeter"><resources/><build/></model>');
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify({
      printer_model: printer,
      printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle",
      nozzle_diameter: ["0.4"],
      layer_height: "0.16",
      sparse_infill_density: "20%",
      wall_loops: "3",
      enable_support: "1",
      filament_type: ["PLA", "PETG", "PLA"],
      filament_colour: ["#FFFFFF", "#000000", "#FF0000"],
    }),
  );
  zip.file(
    "Metadata/model_settings.config",
    `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Body &amp; lid"/>
    <model_instance><metadata key="object_id" value="2"/></model_instance>
    <model_instance><metadata key="object_id" value="3"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value=""/>
    <model_instance><metadata key="object_id" value="4"/></model_instance>
  </plate>
</config>`,
  );
  const plateSlice = (index: number, seconds: number, grams: number, filaments: string) => `
  <plate>
    <metadata key="index" value="${index}"/>
    <metadata key="prediction" value="${seconds}"/>
    <metadata key="weight" value="${grams}"/>
    ${filaments}
  </plate>`;
  const timesOnly = (index: number, seconds: number) =>
    `<plate><metadata key="index" value="${index}"/><metadata key="prediction" value="${seconds}"/></plate>`;
  const slices =
    sliced === "none"
      ? ""
      : sliced === "times"
        ? timesOnly(1, 3600) + timesOnly(2, 1800)
        : sliced === "incomplete"
          ? plateSlice(
              1,
              3600,
              12.5,
              '<filament id="1" type="PLA" color="#FFFFFF" used_g="10.25"/><filament id="2" type="PETG" color="#000000"/>',
            ) + plateSlice(2, 1800, 5, '<filament id="1" type="PLA" color="#FFFFFF" used_m="1.6" used_g="5"/>')
          : plateSlice(
              1,
              3600,
              12.5,
              '<filament id="1" type="PLA" color="#FFFFFFFF" used_m="4.2" used_g="10.25"/>' +
                '<filament id="2" type="PETG" color="#000000" used_m="0.7" used_g="2.25"/>',
            ) +
            (sliced === "all"
              ? plateSlice(2, 1800, 5, '<filament id="1" type="PLA" color="#FFFFFF" used_m="1.6" used_g="5"/>')
              : "");
  zip.file(
    "Metadata/slice_info.config",
    `<?xml version="1.0" encoding="UTF-8"?><config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header>${slices}</config>`,
  );
  zip.file("Metadata/plate_1.png", PLATE_PNG);
  zip.file("Metadata/plate_2.png", PLATE_PNG);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
  return filePath;
}
