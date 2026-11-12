import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { adapt3mf, planAdaptation, planKey, slicerProfile, type AdaptPlan, type ThreeMfFormat } from "../src/adapter";
import {
  bedBoxOf,
  chooseFilament,
  chooseProcess,
  filamentProduct,
  moveBuildItems,
  plateColumns,
  plateMoves,
  processNameParts,
  retargetSettings,
  type PrinterRecipe,
} from "../src/adapter/printer";
import { parsePlates } from "../src/adapter/readers/bambuProject";
import { printerPresetNames, printerTarget } from "../src/printers/targets";

// Pure: no database. The catalogue is the committed one.

const RECIPE: PrinterRecipe = {
  preset: "Bambu Lab P1S 0.4 nozzle",
  model: "Bambu Lab P1S",
  nozzle: 0.4,
  extruders: 1,
  processes: [
    { name: "0.08mm Extra Fine @BBL X1C", layerHeight: 0.08 },
    { name: "0.16mm Optimal @BBL X1C", layerHeight: 0.16 },
    { name: "0.20mm Standard @BBL X1C", layerHeight: 0.2 },
    { name: "0.20mm Strength @BBL X1C", layerHeight: 0.2 },
    { name: "0.28mm Extra Draft @BBL X1C", layerHeight: 0.28 },
  ],
  defaultProcess: "0.20mm Standard @BBL X1C",
  filaments: {
    types: { PLA: "Generic PLA", PETG: "Generic PETG" },
    products: { "bambu pla basic": "Bambu PLA Basic @BBL P1S 0.4 nozzle" },
  },
  everyPrinter: { types: { TPU: "Generic TPU @System" }, products: { "panchroma pla": "Panchroma PLA @System" } },
  bed: { minX: 0, minY: 0, maxX: 256, maxY: 256 },
  height: 250,
};

describe("a copy's presets", () => {
  it("reads a process preset's height and quality, whichever way the slicer writes them", () => {
    expect(processNameParts("0.20mm Strength @BBL A1M")).toEqual({ height: 0.2, quality: "strength" });
    expect(processNameParts("0.20 Standard @Snapmaker U1 (0.4 nozzle)")).toEqual({ height: 0.2, quality: "standard" });
    expect(processNameParts("My process")).toEqual({ height: null, quality: null });
  });

  it("keeps the designer's process where the printer can use it, else the same height and quality", () => {
    expect(chooseProcess(RECIPE, "0.20mm Strength @BBL X1C", 0.2)).toBe("0.20mm Strength @BBL X1C");
    expect(chooseProcess(RECIPE, "0.20mm Strength @BBL A1M", 0.2)).toBe("0.20mm Strength @BBL X1C");
    expect(chooseProcess(RECIPE, "0.16mm Optimal @BBL A1", 0.16)).toBe("0.16mm Optimal @BBL X1C");
    // A quality it hasn't: Standard at that height; a height it hasn't: the nearest.
    expect(chooseProcess(RECIPE, "0.20mm Balanced Quality @BBL H2D", 0.2)).toBe("0.20mm Standard @BBL X1C");
    expect(chooseProcess(RECIPE, "0.25mm Draft @BBL A1M", 0.25)).toBe("0.28mm Extra Draft @BBL X1C");
    // A name without a height goes by the layer height; neither, the printer's default.
    expect(chooseProcess(RECIPE, "Designer's tweaks", 0.08)).toBe("0.08mm Extra Fine @BBL X1C");
    expect(chooseProcess({ ...RECIPE, processes: [] }, "Designer's tweaks", null)).toBe("0.20mm Standard @BBL X1C");
  });

  it("names a filament by its product, whatever printer it was tuned for, and falls back to its type", () => {
    expect(filamentProduct("Bambu PLA Basic @BBL A1M")).toBe("bambu pla basic");
    expect(filamentProduct("Anker Generic PLA 0.2 nozzle")).toBe("anker generic pla");
    const pick = (name: string, type: string, inherits = "") => chooseFilament(RECIPE, { name, inherits, type });
    expect(pick("Bambu PLA Basic @BBL A1M", "PLA")).toBe("Bambu PLA Basic @BBL P1S 0.4 nozzle");
    // A designer's own preset by the one it inherits.
    expect(pick("My copy", "PLA", "Bambu PLA Basic @BBL X1C")).toBe("Bambu PLA Basic @BBL P1S 0.4 nozzle");
    expect(pick("Panchroma PLA @BBL A1", "PLA")).toBe("Panchroma PLA @System");
    expect(pick("Bambu PETG HF @BBL A1M", "PETG")).toBe("Generic PETG");
    expect(pick("Bambu TPU 95A @BBL A1M", "tpu")).toBe("Generic TPU @System");
    // None of its type: not another material's preset, whose temperatures would replace the designer's.
    expect(pick("Bambu PA6-CF @BBL X1E", "PA6-CF")).toBeNull();
  });

  it("gives a product the printer names for another material way to the preset of the designer's type", () => {
    const recipe: PrinterRecipe = {
      ...RECIPE,
      filaments: {
        types: { ...RECIPE.filaments!.types, "PETG-CF": "Generic PETG-CF" },
        products: {
          ...RECIPE.filaments!.products,
          "generic pla": "Generic PLA",
          "generic petg": "Generic PETG",
          "generic petg-cf": "Generic PETG-CF",
        },
      },
    };
    const pick = (name: string, type: string) => chooseFilament(recipe, { name, inherits: "", type });
    expect(pick("Generic PLA @BBL A1M", "PLA")).toBe("Generic PLA");
    // A Generic PLA changed to PETG: the PLA preset would set its temperatures to PLA's.
    expect(pick("Generic PLA @BBL A1M", "PETG")).toBe("Generic PETG");
    // A kind of the same material keeps the product.
    expect(pick("Generic PETG-CF @BBL X1C", "PETG")).toBe("Generic PETG-CF");
    // So do a type the printer has no preset of, which may be the same material by another name, and no type.
    expect(pick("Generic PETG @BBL X1C", "PET")).toBe("Generic PETG");
    expect(pick("Generic PLA @BBL A1M", "")).toBe("Generic PLA");
    // A product that's no type's preset has no type in the catalogue, so it keeps its match.
    expect(pick("Bambu PLA Basic @BBL A1M", "PETG")).toBe("Bambu PLA Basic @BBL P1S 0.4 nozzle");
  });
});

const DESIGNER = {
  printer_settings_id: "Bambu Lab H2D 0.4 nozzle",
  printer_model: "Bambu Lab H2D",
  print_settings_id: "0.20mm Standard @BBL H2D",
  filament_settings_id: ["Bambu PLA Basic @BBL H2D", "Bambu PA6-CF @BBL H2D"],
  filament_type: ["PLA", "PA6-CF"],
  filament_colour: ["#FFFFFF", "#000000"],
  filament_map: ["1", "2"],
  filament_adhesiveness_category: ["100"],
  different_settings_to_system: ["wall_loops;sparse_infill_density", "nozzle_temperature", "", "retraction_length"],
  print_compatible_printers: ["Bambu Lab H2D 0.4 nozzle"],
  compatible_machine_expression_group: ["", "", "", ""],
  compatible_process_expression_group: ["", ""],
  layer_height: "0.2",
  wall_loops: "4",
  printable_area: ["0x0", "350x0", "350x320", "0x320"],
  machine_start_gcode: "G28 ; H2D start",
  wipe_tower_x: ["165", "300"],
  wipe_tower_y: ["250", "10"],
  prime_tower_width: "35",
  prime_tower_brim_width: "3",
};

describe("a copy's settings", () => {
  const { settings, process, filaments, from } = retargetSettings(DESIGNER, RECIPE);

  it("names the printer's presets and keeps the designer's list of changes, but not for their printer", () => {
    expect(settings.printer_settings_id).toBe("Bambu Lab P1S 0.4 nozzle");
    expect(settings.printer_model).toBe("Bambu Lab P1S");
    expect(process).toBe("0.20mm Standard @BBL X1C");
    expect(settings.print_settings_id).toBe(process);
    // The printer has no PA6-CF preset, so that filament keeps the designer's.
    expect(filaments).toEqual(["Bambu PLA Basic @BBL P1S 0.4 nozzle", "Bambu PA6-CF @BBL H2D"]);
    expect(settings.inherits_group).toEqual(["", "", "", ""]);
    // The printer's slot is emptied.
    expect(settings.different_settings_to_system).toEqual([
      "wall_loops;sparse_infill_density",
      "nozzle_temperature",
      "",
      "",
    ]);
    expect(settings.print_compatible_printers).toEqual(["Bambu Lab P1S 0.4 nozzle"]);
    expect(settings.wall_loops).toBe("4");
  });

  it("has a slot for each filament preset, with or without a colour for it", () => {
    const { filament_colour: _colours, ...uncoloured } = DESIGNER;
    const copy = retargetSettings(uncoloured, RECIPE);
    expect(copy.filaments).toEqual(["Bambu PLA Basic @BBL P1S 0.4 nozzle", "Bambu PA6-CF @BBL H2D"]);
    expect(copy.settings.inherits_group).toHaveLength(4);
    expect(copy.settings.filament_adhesiveness_category).toEqual(["100", "100"]);
    // The slicers would load just the first filament, in their default colour, so each gets that colour.
    expect(copy.settings.filament_colour).toEqual(["#F2754E", "#F2754E"]);
    expect(retargetSettings({ ...DESIGNER, filament_colour: [] }, RECIPE).settings.filament_colour).toEqual([
      "#F2754E",
      "#F2754E",
    ]);
    const short = retargetSettings({ ...DESIGNER, filament_colour: ["#FFFFFF"] }, RECIPE);
    expect(short.settings.filament_colour).toEqual(["#FFFFFF", "#FFFFFF"]);
  });

  it("leaves out the designer's printer's G-code and sizes per-filament lists to the filaments", () => {
    expect(settings.machine_start_gcode).toBeUndefined();
    expect(settings.filament_map).toEqual(["1", "1"]);
    expect(settings.filament_adhesiveness_category).toEqual(["100", "100"]);
    expect(settings.printable_area).toEqual(["0x0", "256x0", "256x256", "0x256"]);
    expect(settings.printable_height).toBe("250");
  });

  it("moves each plate's wipe tower as its objects move, and keeps it on the bed", () => {
    expect(from).toEqual({ minX: 0, minY: 0, maxX: 350, maxY: 320 });
    // 165 - 175 + 128 = 118; y 250 - 160 + 128 = 218, past 256 - 35 - 5 = 216.
    expect(settings.wipe_tower_x).toEqual(["118", "216"]);
    expect(settings.wipe_tower_y).toEqual(["216", "5"]);
  });
});

describe("a copy's plates", () => {
  it("are laid out the way the slicers do it", () => {
    expect([1, 2, 3, 4, 5, 9, 10, 13].map(plateColumns)).toEqual([1, 2, 2, 2, 3, 3, 4, 4]);
    expect(bedBoxOf(["0.5x1", "270.5x1", "270.5x271", "0.5x271"])).toEqual({
      minX: 0.5,
      minY: 1,
      maxX: 270.5,
      maxY: 271,
    });
    expect(bedBoxOf(["0x0"])).toBeNull();
  });

  it("move from the middle of the designer's plate to the middle of the same plate on the printer's bed", () => {
    const plates = parsePlates(`<config>
      <plate><metadata key="plater_id" value="1"/>
        <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance></plate>
      <plate><metadata key="plater_id" value="2"/>
        <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="1"/></model_instance>
        <model_instance><metadata key="object_id" value="4"/><metadata key="instance_id" value="0"/></model_instance></plate>
    </config>`);
    const moves = plateMoves(
      plates,
      { minX: 0, minY: 0, maxX: 350, maxY: 320 },
      { minX: 0, minY: 0, maxX: 180, maxY: 180 },
    );
    // Plate 2 is a column over: 350 * 1.2 = 420 on the H2D, 216 on the A1 mini.
    expect(moves.get("2:0")).toEqual([-85, -70]);
    expect(moves.get("2:1")).toEqual([216 - 420 - 85, -70]);
    const build = `<build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 175 160 0" printable="1"/>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 600 150 0"/>
  <item objectid="4" printable="1"/>
  <item objectid="9" transform="1 0 0 0 1 0 0 0 1 5 5 0"/>
 </build>`;
    const out = moveBuildItems(build, moves) ?? "";
    expect(out).toContain('<item objectid="2" transform="1 0 0 0 1 0 0 0 1 90 90 0" printable="1"/>');
    expect(out).toContain('<item objectid="2" transform="1 0 0 0 1 0 0 0 1 311 80 0"/>');
    expect(out).toContain('<item objectid="4" printable="1" transform="1 0 0 0 1 0 0 0 1 -289 -70 0"/>');
    // On no plate: left where it was.
    expect(out).toContain('<item objectid="9" transform="1 0 0 0 1 0 0 0 1 5 5 0"/>');
  });
});

const FORMAT: ThreeMfFormat = {
  v: 1,
  kind: "bambu",
  app: "BambuStudio",
  appVersion: "02.03.00.70",
  orcaTag: null,
  printer: "Bambu Lab H2D 0.4 nozzle",
  nozzle: 0.4,
  filaments: 2,
  plates: 2,
  dialect: "bambu",
};

describe("planning a copy for a printer", () => {
  const p1s = { id: "bambulab-p1s", nozzle: "0.4", preset: "Bambu Lab P1S 0.4 nozzle", stamp: "abc" };

  it("is for slicers that load presets by name, unless the project was made for that very preset", () => {
    expect(planAdaptation(FORMAT, slicerProfile("bambustudio"), p1s)).toEqual({
      output: "bambu",
      tag: null,
      dropOrcaTag: false,
      dialect: null,
      printer: p1s,
    });
    expect(
      planAdaptation(FORMAT, slicerProfile("bambustudio"), { ...p1s, preset: "Bambu Lab H2D 0.4 nozzle" }),
    ).toBeNull();
    // Creality Print asks for the printer itself; the flattened copies keep the user's own setup.
    expect(planAdaptation(FORMAT, slicerProfile("crealityprintlink"), p1s)).not.toHaveProperty("printer");
    expect(planAdaptation(FORMAT, slicerProfile("prusaslicer"), p1s)).toEqual({ output: "prusa" });
  });

  it("names the copy for the printer, so a printer's copy is never another's", () => {
    const plan = planAdaptation(FORMAT, slicerProfile("orcaslicer"), p1s) as AdaptPlan;
    expect(planKey(plan)).toBe("bambu-orca-for-bambulab-p1s-0.4-abc");
    expect(planKey({ ...plan, printer: undefined } as AdaptPlan)).toBe("bambu-orca");
  });
});

describe("the catalogue's recipes", () => {
  it("name each slicer's own presets for a printer", () => {
    const orca = printerTarget("orcaslicer", "bambulab-p1s", "0.4");
    expect(orca?.choice).toMatchObject({ id: "bambulab-p1s", nozzle: "0.4", preset: "Bambu Lab P1S 0.4 nozzle" });
    expect(orca?.recipe.bed).toEqual({ minX: 0, minY: 0, maxX: 256, maxY: 256 });
    expect(orca?.recipe.processes.length).toBeGreaterThan(3);
    expect(orca?.recipe.filaments?.products["bambu pla basic"]).toMatch(/^Bambu PLA Basic @BBL/);
    // OrcaSlicer's library is installed for every printer.
    expect(orca?.recipe.everyPrinter?.types.PLA).toBe("Generic PLA @System");
    const u1 = printerTarget("snapmaker-orca", "snapmaker-u1", "0.4");
    expect(u1?.choice.preset).toBe("Snapmaker U1 (0.4 nozzle)");
    expect(u1?.recipe.bed).toEqual({ minX: 0.5, minY: 1, maxX: 270.5, maxY: 271 });
  });

  it("take the nearest nozzle a slicer has, and none for a printer the slicer doesn't know", () => {
    expect(printerTarget("bambustudio", "bambulab-p1s", "0.5")?.choice.nozzle).toBe("0.4");
    expect(printerTarget("bambustudio", "prusaresearch-coreone", "0.4")).toBeNull();
    expect(printerTarget("orcaslicer", "no-such-printer", "0.4")).toBeNull();
    expect(printerPresetNames("bambulab-p1s", "0.4", ["bambustudio", "cura"])).toEqual({
      bambustudio: "Bambu Lab P1S 0.4 nozzle",
      cura: null,
    });
  });

  it("change their stamp with what they say, so copies made from an older catalogue are made again", () => {
    const a = printerTarget("orcaslicer", "bambulab-p1s", "0.4");
    const b = printerTarget("orcaslicer", "bambulab-p1s", "0.6");
    expect(a?.choice.stamp).toMatch(/^[0-9a-f]{10}$/);
    expect(a?.choice.stamp).toBe(printerTarget("orcaslicer", "bambulab-p1s", "0.4")?.choice.stamp);
    expect(a?.choice.stamp).not.toBe(b?.choice.stamp);
  });
});

const ROOT = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.03.00.70</metadata>
 <resources>
  <object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
  <object id="4" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 175 160 2" printable="1"/>
  <item objectid="4" transform="1 0 0 0 1 0 0 0 1 595 160 2" printable="1"/>
 </build>
</model>
`;

async function project(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", ROOT);
  zip.file("3D/Objects/object_1.model", '<model><resources><object id="1"><mesh/></object></resources></model>');
  zip.file("Metadata/project_settings.config", JSON.stringify(DESIGNER));
  zip.file(
    "Metadata/model_settings.config",
    `<config>
  <object id="2"><metadata key="name" value="A"/></object>
  <object id="4"><metadata key="name" value="B"/></object>
  <plate><metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance></plate>
  <plate><metadata key="plater_id" value="2"/>
    <model_instance><metadata key="object_id" value="4"/><metadata key="instance_id" value="0"/></model_instance></plate>
</config>`,
  );
  zip.file("Metadata/slice_info.config", "<config/>");
  zip.file("Metadata/process_settings_1.config", "{}");
  zip.file("Metadata/plate_1.png", "png");
  return zip.generateAsync({ type: "uint8array" });
}

describe("the copy for a printer", () => {
  it("names its presets, moves the plates onto its bed and leaves the designer's own presets out", async () => {
    const target = printerTarget("bambustudio", "bambulab-a1mini", "0.4");
    if (!target) throw new Error("the catalogue has no A1 mini in Bambu Studio");
    const plan = planAdaptation(FORMAT, slicerProfile("bambustudio"), target.choice) as AdaptPlan;
    const written = await adapt3mf(await project(), plan, { printer: target.recipe });
    const zip = await JSZip.loadAsync(await written.zip.generateAsync({ type: "uint8array" }));
    const settings = JSON.parse(await zip.file("Metadata/project_settings.config")!.async("string"));
    expect(settings.printer_settings_id).toBe("Bambu Lab A1 mini 0.4 nozzle");
    expect(settings.print_settings_id).toBe("0.20mm Standard @BBL A1M");
    expect(settings.filament_settings_id[0]).toBe("Bambu PLA Basic @BBL A1M");
    const root = await zip.file("3D/3dmodel.model")!.async("string");
    expect(root).toContain('<metadata name="Application">BambuStudio-02.03.00.70</metadata>');
    expect(root).toContain('<item objectid="2" transform="1 0 0 0 1 0 0 0 1 90 90 2" printable="1"/>');
    expect(root).toContain('<item objectid="4" transform="1 0 0 0 1 0 0 0 1 306 90 2" printable="1"/>');
    expect(zip.file("Metadata/slice_info.config")).toBeNull();
    expect(zip.file("Metadata/process_settings_1.config")).toBeNull();
    expect(zip.file("Metadata/plate_1.png")).not.toBeNull();
    expect(written.report()).toMatchObject({
      output: "bambu",
      printer: "Bambu Lab A1 mini 0.4 nozzle",
      process: "0.20mm Standard @BBL A1M",
    });
  });

  it("is the plain copy without the catalogue's recipe, or without project settings to name presets in", async () => {
    const plan: AdaptPlan = {
      output: "bambu",
      tag: null,
      dropOrcaTag: false,
      dialect: null,
      printer: { id: "bambulab-a1mini", nozzle: "0.4", preset: "Bambu Lab A1 mini 0.4 nozzle" },
    };
    const written = await adapt3mf(await project(), plan);
    const zip = await JSZip.loadAsync(await written.zip.generateAsync({ type: "uint8array" }));
    expect(await zip.file("3D/3dmodel.model")!.async("string")).toBe(ROOT);
    expect(zip.file("Metadata/slice_info.config")).not.toBeNull();
    expect(written.report().printer).toBeUndefined();
  });
});
