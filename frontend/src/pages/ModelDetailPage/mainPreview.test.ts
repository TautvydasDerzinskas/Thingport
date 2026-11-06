import { describe, expect, it } from "vitest";
import type { Plate, Print } from "../../api/prints";
import { mainPreviewPlates, selectedModelFile } from "./mainPreview";
import type { ModelFile } from "./useOpenInSlicer";

function plate(id: string, filename: string, isDefault = false): Plate {
  return { id, filename, url: `/f/${id}`, position: 0, is_default: isDefault } as unknown as Plate;
}

function fileOf(p: Plate, index: number): ModelFile {
  return { key: p.id, url: p.url, filename: p.filename, launchFilename: p.filename, index, plate: p };
}

const prepared: ModelFile = {
  key: "prepared",
  url: "/prepared",
  filename: "print.gcode.3mf",
  launchFilename: "print.gcode.3mf",
  index: -1,
  plate: null,
};

function setup(plates: Plate[], withPrepared = false) {
  const print = { plates } as unknown as Print;
  const files = [...(withPrepared ? [prepared] : []), ...plates.map(fileOf)];
  return { print, files };
}

describe("selectedModelFile", () => {
  it("takes the picked file, else the default, else the first", () => {
    const { files } = setup([plate("a", "a.3mf"), plate("b", "b.3mf", true), plate("c", "c.3mf")]);
    expect(selectedModelFile(files, "c")?.key).toBe("c");
    expect(selectedModelFile(files, null)?.key).toBe("b");
    // A key from another model, kept across a navigation, falls back the same way.
    expect(selectedModelFile(files, "gone")?.key).toBe("b");
    expect(selectedModelFile(setup([plate("a", "a.3mf"), plate("b", "b.3mf")]).files, null)?.key).toBe("a");
  });

  it("is null for a model without files", () => {
    expect(selectedModelFile([], null)).toBeNull();
  });
});

describe("mainPreviewPlates", () => {
  it("follows the picked file", () => {
    const { print, files } = setup([plate("a", "a.3mf"), plate("b", "b.stl")]);
    const { selectedPlate, plate3d } = mainPreviewPlates(print, files, "b");
    expect(selectedPlate?.id).toBe("b");
    expect(plate3d?.id).toBe("b");
  });

  it("opens the 3D preview with the first plate when the picked file isn't a 3D one", () => {
    const { print, files } = setup([plate("a", "a.3mf"), plate("b", "notes.pdf")]);
    const { selectedPlate, plate3d } = mainPreviewPlates(print, files, "b");
    expect(selectedPlate?.id).toBe("b");
    expect(plate3d?.id).toBe("a");
  });

  it("has no plate for the prepared print, and the 3D preview falls back to the first plate", () => {
    const { print, files } = setup([plate("a", "a.3mf")], true);
    const { selectedPlate, plate3d } = mainPreviewPlates(print, files, "prepared");
    expect(selectedPlate).toBeNull();
    expect(plate3d?.id).toBe("a");
  });

  it("offers no 3D preview without a 3D file, and nothing for a model without plates", () => {
    const pdfOnly = setup([plate("a", "manual.pdf")]);
    expect(mainPreviewPlates(pdfOnly.print, pdfOnly.files, null).plate3d).toBeNull();
    const empty = setup([]);
    expect(mainPreviewPlates(empty.print, empty.files, null)).toEqual({ selectedPlate: null, plate3d: null });
  });
});
