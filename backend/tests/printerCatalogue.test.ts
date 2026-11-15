import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  brandPrinters,
  printer,
  printerBrands,
  printerCoverFile,
  printerForName,
  printerSummaries,
  printersForBambuCode,
} from "../src/printers/catalogue";
// The generator's own parts (scripts/printers), which the committed catalogue is made with.
import { Condition } from "../../scripts/printers/lib/condition.mjs";
import { alternatives, nameKey, splitConfig, stripBrand } from "../../scripts/printers/lib/identity.mjs";

const DIR = path.resolve(__dirname, "../assets/printers");

describe("the committed printer catalogue", () => {
  it("lists each printer once, under a brand it has, with a bed, nozzles and extruders that make sense", () => {
    const printers = printerSummaries();
    expect(printers.length).toBeGreaterThan(900);
    expect(new Set(printers.map((p) => p.id)).size).toBe(printers.length);
    const brands = new Map(printerBrands().map((b) => [b.id, b]));
    const wrong = printers.filter(
      (p) =>
        !brands.has(p.brand) ||
        !p.id.startsWith(`${p.brand}-`) ||
        (p.bed && !(p.bed.x > 0 && p.bed.y > 0)) ||
        !(p.height === null || p.height > 0) ||
        !p.nozzles.length ||
        p.nozzles.some((n) => !(Number(n) > 0 && Number(n) < 10)) ||
        !(p.extruders >= 1),
    );
    expect(wrong.map((p) => p.id)).toEqual([]);
    const miscounted = [...brands.values()].filter(
      (b) => printers.filter((p) => p.brand === b.id).length !== b.printers,
    );
    expect(miscounted.map((b) => b.id)).toEqual([]);
  });

  it("has every brand's printers in full in that brand's file, and a picture for those that say so", () => {
    const covers = new Set(fs.readdirSync(path.join(DIR, "covers")));
    const pictured = new Set<string>();
    const wrong: string[] = [];
    for (const b of printerBrands()) {
      const full = brandPrinters(b.id);
      const listed = printerSummaries().filter((p) => p.brand === b.id);
      if (
        full
          .map((p) => p.id)
          .toSorted()
          .join() !==
        listed
          .map((p) => p.id)
          .toSorted()
          .join()
      )
        wrong.push(`brand ${b.id}`);
      for (const p of full) {
        if (!Object.keys(p.slicers).length) wrong.push(`${p.id} has no slicer`);
        if (p.cover) pictured.add(`${p.id}.webp`);
      }
    }
    expect(wrong).toEqual([]);
    expect([...covers].toSorted()).toEqual([...pictured].toSorted());
  });

  it("knows every name it lists as one of its printers", () => {
    const { names } = JSON.parse(fs.readFileSync(path.join(DIR, "names.json"), "utf8")) as {
      names: Record<string, [string, string?]>;
    };
    const ids = new Set(printerSummaries().map((p) => p.id));
    expect(Object.entries(names).filter(([, [id]]) => !ids.has(id))).toEqual([]);
  });
});

describe("finding a printer", () => {
  it("by the name a slicer gives its preset, its model or a Cura definition, whatever the case", () => {
    expect(printerForName("Bambu Lab P1S 0.4 nozzle")).toMatchObject({
      printer: { id: "bambulab-p1s" },
      nozzle: "0.4",
    });
    expect(printerForName("bambu lab p1s")?.printer.id).toBe("bambulab-p1s");
    expect(printerForName("Original Prusa MK4S HF0.4 nozzle")).toMatchObject({
      printer: { id: "prusaresearch-mk4s" },
      nozzle: "HF0.4",
    });
    expect(printerForName("ultimaker_s5")?.printer.id).toBe("ultimaker-s5");
    expect(printerForName("My own printer")).toBeNull();
    expect(printerForName("constructor")).toBeNull();
    expect(printerForName("")).toBeNull();
  });

  it("by the model code Bambu Lab's cloud lists a bound printer under", () => {
    expect(printersForBambuCode("C12").map((p) => p.id)).toEqual(["bambulab-p1s"]);
    expect(printersForBambuCode("nope")).toEqual([]);
  });

  it("in full, with each slicer's presets for it", () => {
    const p1s = printer("bambulab-p1s")!;
    expect(p1s).toMatchObject({ brand: "bambulab", model: "P1S", height: 250, codes: { bambu: "C12" } });
    expect(p1s.bed).toMatchObject({ shape: "rectangle", x: 256, y: 256 });
    const studio = p1s.slicers.bambustudio[0].presets!["0.4"][0];
    expect(studio.name).toBe("Bambu Lab P1S 0.4 nozzle");
    expect(studio.processes.some((p) => p.name === studio.defaultProcess)).toBe(true);
    // Other makers' slicers ship Bambu Lab's printers too, under the same preset names.
    expect(Object.keys(p1s.slicers)).toEqual(
      expect.arrayContaining(["bambustudio", "orcaslicer", "crealityprintlink"]),
    );
    expect(p1s.slicers.crealityprintlink[0].presets!["0.4"][0].name).toBe("Bambu Lab P1S 0.4 nozzle");
    expect(printerCoverFile("bambulab-p1s")).toMatch(/covers[/\\]bambulab-p1s\.webp$/);
    expect(printer("nope")).toBeNull();
  });
});

describe("the catalogue generator", () => {
  it("reads PrusaSlicer's compatible_printers_condition without eval", () => {
    const env = {
      printer_notes: "PRINTER_VENDOR_PRUSA3D PRINTER_MODEL_MK4S",
      printer_model: "MK4S",
      nozzle_diameter: [0.4],
      nozzle_high_flow: [false],
      num_extruders: 1,
    };
    expect(new Condition("printer_notes=~/.*PRINTER_MODEL_MK4S.*/ and nozzle_diameter[0]==0.4").test(env)).toBe(true);
    expect(new Condition("nozzle_diameter[0]==0.6 or nozzle_high_flow[0]").test(env)).toBe(false);
    expect(new Condition('printer_model=="MK4S" and ! (num_extruders > 1)').test(env)).toBe(true);
    expect(() => new Condition("unknown_variable == 1").test(env)).toThrow(/unknown variable/);
    expect(() => new Condition("nozzle_diameter[0] ==")).toThrow(/unexpected/);
  });

  it("names the same printer alike whatever the slicer calls it", () => {
    expect(nameKey("Ender-3 V2")).toBe("ender3v2");
    expect(nameKey("4Max Pro 2.0")).toBe(nameKey("4Max Pro 2"));
    expect(stripBrand("Bambu Lab P1S", "Bambu Lab")).toBe("P1S");
    expect(stripBrand("Original Prusa MK4S", "Prusa Research")).toBe("MK4S");
    expect(splitConfig("MK4S MMU3")).toMatchObject({ model: "MK4S", labels: ["MMU3"], multiMaterial: ["Prusa MMU3"] });
    expect(splitConfig("H2D Combo")).toMatchObject({ model: "H2D", labels: ["Combo"] });
    expect(alternatives("MK3S & MK3S+")).toEqual(["MK3S", "MK3S+"]);
    expect(alternatives("CORE One & One+")).toEqual(["CORE One", "CORE One+"]);
  });
});
