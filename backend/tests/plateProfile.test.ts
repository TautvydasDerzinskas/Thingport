import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { readZipEntryPrefix } from "../src/utils/zipReader";
import { hasAnyProfileValue, readPlateProfile, readPlateProfileChecked } from "../src/services/plateProfile";

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plate-profile-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function model(metadata: Record<string, string>, padding = 0): string {
  const rows = Object.entries(metadata)
    .map(([name, value]) => `<metadata name="${name}">${value}</metadata>`)
    .join("");
  return `<?xml version="1.0"?><model>${rows}${" ".repeat(padding)}<resources/></model>`;
}

async function write3mf(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const file = path.join(dir, `f${counter++}.3mf`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}

const NO_VALUES = {
  title: null,
  printer: null,
  nozzle_mm: null,
  layer_height_mm: null,
  materials: [],
  plates: null,
  estimated_seconds: null,
  weight_g: null,
  plate_stats: [],
};

describe("readZipEntryPrefix", () => {
  it("returns the first bytes of a large entry", async () => {
    const file = await write3mf({ "big.txt": "abcdefghij".repeat(1000) });
    const prefix = await readZipEntryPrefix(file, "big.txt", 25);
    expect(prefix?.toString()).toBe("abcdefghij".repeat(2) + "abcde");
    expect(await readZipEntryPrefix(file, "missing.txt", 25)).toBeNull();
  });
});

describe("readPlateProfile", () => {
  it("reads a Bambu Studio project", async () => {
    const file = await write3mf({
      "3D/3dmodel.model": model({ ProfileTitle: "0.22mm layer, 2 walls, 10% infill" }),
      "Metadata/project_settings.config": JSON.stringify({
        printer_model: "Bambu Lab A1 mini",
        nozzle_diameter: ["0.4"],
        layer_height: "0.22",
        filament_type: ["PLA", "PLA"],
      }),
      "Metadata/plate_1.json": "{}",
      "Metadata/plate_2.json": "{}",
      "Metadata/plate_3.json": "{}",
    });
    expect(await readPlateProfile(file)).toEqual({
      title: "0.22mm layer, 2 walls, 10% infill",
      printer: "Bambu Lab A1 mini",
      nozzle_mm: 0.4,
      layer_height_mm: 0.22,
      materials: ["PLA"],
      plates: 3,
      estimated_seconds: null,
      weight_g: null,
      plate_stats: [],
    });
  });

  it("ignores Title", async () => {
    const file = await write3mf({ "3D/3dmodel.model": model({ Title: "X" }) });
    expect((await readPlateProfile(file)).title).toBeNull();
  });

  it("reads a PrusaSlicer config", async () => {
    const file = await write3mf({
      "Metadata/Slic3r_PE.config": [
        "; printer_model = MK4",
        "; nozzle_diameter = 0.4,0.4",
        "; layer_height = 0.2",
        "; filament_type = PLA;PETG",
      ].join("\n"),
    });
    expect(await readPlateProfile(file)).toMatchObject({
      printer: "MK4",
      nozzle_mm: 0.4,
      layer_height_mm: 0.2,
      materials: ["PLA", "PETG"],
    });
  });

  it("falls back to other key names", async () => {
    const file = await write3mf({
      "Metadata/project_settings.config": JSON.stringify({
        printer_settings_id: "My Printer 0.6 nozzle",
        printer_nozzle_diameter: "0.6",
        filament_settings_id: ["Generic PETG @BBL A1"],
      }),
    });
    expect(await readPlateProfile(file)).toMatchObject({
      printer: "My Printer 0.6 nozzle",
      nozzle_mm: 0.6,
      materials: ["GENERIC PETG"],
    });
  });

  it("reads print time and weight from a sliced file", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><plate><metadata key="prediction" value="600"/><metadata key="weight" value="10.5"/></plate><plate><metadata key="prediction" value="900"/><metadata key="weight" value="4.5"/></plate></config>`,
    });
    expect(await readPlateProfile(file)).toMatchObject({ estimated_seconds: 1500, weight_g: 15 });
  });

  it("reads time and weight per plate", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><header/><plate><metadata key="index" value="1"/><metadata key="prediction" value="600"/><metadata key="weight" value="10.5"/></plate><plate><metadata key="index" value="2"/><metadata key="prediction" value="900"/><metadata key="weight" value="4.5"/></plate></config>`,
    });
    expect((await readPlateProfile(file)).plate_stats).toEqual([
      { index: 1, estimated_seconds: 600, weight_g: 10.5 },
      { index: 2, estimated_seconds: 900, weight_g: 4.5 },
    ]);
  });

  it("gives null for the values a plate lacks", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="600"/><metadata key="weight" value="10"/></plate><plate><metadata key="index" value="2"/><metadata key="weight" value="0"/></plate></config>`,
    });
    const profile = await readPlateProfile(file);
    expect(profile.plate_stats).toEqual([
      { index: 1, estimated_seconds: 600, weight_g: 10 },
      { index: 2, estimated_seconds: null, weight_g: null },
    ]);
    expect(profile).toMatchObject({ estimated_seconds: 600, weight_g: 10 });
  });

  it("has no plate stats for an unsliced file", async () => {
    const file = await write3mf({ "Metadata/project_settings.config": JSON.stringify({ printer_model: "X" }) });
    expect((await readPlateProfile(file)).plate_stats).toEqual([]);
  });

  it("finds ProfileTitle at the start of a large model file", async () => {
    const file = await write3mf({ "3D/3dmodel.model": model({ ProfileTitle: "Big one" }, 200 * 1024) });
    expect((await readPlateProfile(file)).title).toBe("Big one");
  });

  it("finds ProfileTitle after a long Description", async () => {
    const file = await write3mf({
      "3D/3dmodel.model": model({ Description: "d".repeat(300 * 1024), ProfileTitle: "After the text" }),
    });
    expect((await readPlateProfile(file)).title).toBe("After the text");
  });

  it("decodes named and numeric entities in the title", async () => {
    const file = await write3mf({ "3D/3dmodel.model": model({ ProfileTitle: "K&#228;se &#xE4; &amp; &lt;x&gt;" }) });
    expect((await readPlateProfile(file)).title).toBe("Käse ä & <x>");
  });

  it("parses a huge metadata tag without '=' quickly", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><metadata ${"a ".repeat(400 * 1024)}/><plate><metadata key="weight" value="3"/></plate></config>`,
    });
    const start = Date.now();
    const profile = await readPlateProfile(file);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(profile.weight_g).toBe(3);
  });

  it("finds ProfileTitle whatever the attribute order or quotes", async () => {
    const file = await write3mf({
      "3D/3dmodel.model": `<model><metadata type="x" name='ProfileTitle'>Single quoted</metadata></model>`,
    });
    expect((await readPlateProfile(file)).title).toBe("Single quoted");
  });

  it("sums the plates only, not header metadata", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><header><metadata key="weight" value="999"/></header><plate><metadata key="index" value="1"/><metadata key="weight" value="5"/></plate></config>`,
    });
    expect(await readPlateProfile(file)).toMatchObject({ weight_g: 5 });
  });

  it("reports an oversized slice_info as incomplete", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config>${" ".repeat(1024 * 1024 + 10)}</config>`,
    });
    expect((await readPlateProfileChecked(file)).complete).toBe(false);
    const ok = await write3mf({ "Metadata/slice_info.config": "<config/>" });
    expect((await readPlateProfileChecked(ok)).complete).toBe(true);
  });

  it("reports an entry that can't be opened as incomplete", async () => {
    const file = await write3mf({ "Metadata/slice_info.config": "<config/>" });
    const bytes = fs.readFileSync(file);
    // Mark the file as bzip2 (12) in the local header and the central directory: its stream can't be opened.
    for (const [sig, offset] of [
      [[0x50, 0x4b, 0x03, 0x04], 8],
      [[0x50, 0x4b, 0x01, 0x02], 10],
    ] as const) {
      const at = bytes.lastIndexOf(Buffer.from(sig)); // the last entry; the first is the Metadata/ folder
      bytes.writeUInt16LE(12, at + offset);
    }
    fs.writeFileSync(file, bytes);
    expect((await readPlateProfileChecked(file)).complete).toBe(false);
  });

  it("takes the plate count from slice_info when there are no plate files", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><plate><metadata key="index" value="1"/></plate><plate><metadata key="index" value="2"/></plate></config>`,
    });
    expect((await readPlateProfile(file)).plates).toBe(2);
  });

  it("reports a non-zip file as incomplete", async () => {
    const text = path.join(dir, "broken.3mf");
    fs.writeFileSync(text, "not a zip");
    expect((await readPlateProfileChecked(text)).complete).toBe(false);
  });

  describe("hostile input stays fast", () => {
    // A 3MF comes from the internet; each shape below made one regex rescan the rest of the file from every start.
    const BIG = 900_000;
    const timed = async (files: Record<string, string>) => {
      const file = await write3mf(files);
      const start = Date.now();
      const profile = await readPlateProfile(file);
      expect(Date.now() - start).toBeLessThan(1000);
      return profile;
    };

    it("a settings line with endless whitespace", async () => {
      const profile = await timed({
        "Metadata/Slic3r_PE.config": `printer_model = X\nk =${" ".repeat(BIG)}x`,
      });
      expect(profile.printer).toBe("X");
    });

    it("<plate> tags that never end", async () => {
      const profile = await timed({
        "Metadata/slice_info.config": `<config>${"<plate>".repeat(BIG / 7)}</config>`,
      });
      expect(profile.plate_stats).toEqual([]);
    });

    it("a ProfileTitle that never ends", async () => {
      const profile = await timed({
        "3D/3dmodel.model": `<model>${'<metadata name="ProfileTitle">'.repeat(BIG / 60)}</model>`,
      });
      expect(profile.title).toBeNull();
    });
  });

  it("prefers the filaments used in slice_info over the project's slots", async () => {
    const file = await write3mf({
      "Metadata/project_settings.config": JSON.stringify({ filament_type: ["PLA", "PETG", "ABS", "TPU"] }),
      "Metadata/slice_info.config": `<config><plate><filament id="1" type="PETG"/></plate></config>`,
    });
    expect((await readPlateProfile(file)).materials).toEqual(["PETG"]);
  });

  it("does not take the printer model id as the printer name", async () => {
    const file = await write3mf({
      "Metadata/slice_info.config": `<config><plate><metadata key="printer_model_id" value="C12"/></plate></config>`,
    });
    expect((await readPlateProfile(file)).printer).toBeNull();
  });

  it("returns all nulls for a 3MF with only geometry", async () => {
    const file = await write3mf({ "3D/3dmodel.model": "<model><resources/></model>" });
    const profile = await readPlateProfile(file);
    expect(profile).toEqual(NO_VALUES);
    expect(hasAnyProfileValue(profile)).toBe(false);
  });

  it("survives broken JSON and a non-zip file", async () => {
    const file = await write3mf({
      "3D/3dmodel.model": model({ ProfileTitle: "Still here" }),
      "Metadata/project_settings.config": "{ not json",
    });
    const profile = await readPlateProfile(file);
    expect(profile).toEqual({ ...NO_VALUES, title: "Still here" });
    expect(hasAnyProfileValue(profile)).toBe(true);

    const text = path.join(dir, "not-a-zip.3mf");
    fs.writeFileSync(text, "not a zip");
    expect(await readPlateProfile(text)).toEqual(NO_VALUES);
  });
});
