import { describe, expect, it, vi } from "vitest";
import type { Plate } from "../../api/prints";
import type { UserPrinter } from "../../api/printers";

// The links are the server's business; these stand-ins say which copy a target opens.
vi.mock("../../api/prints", () => ({
  printsApi: {
    adaptedPlateUrl: (plate: Plate, slicer: string, made?: { id: string; nozzle: string } | null) =>
      `${plate.url}#adapted-for-${slicer}${made ? `-${made.id}-${made.nozzle}` : ""}`,
    slicerFileUrl: (rel: string) => `http://instance${rel}`,
  },
}));

const { adaptedTargetsFor, isAdaptedTarget, modelFiles, printersKnownFor, slicerFilesOf, slicerHref } =
  await import("./useOpenInSlicer");

const plate: Plate = {
  id: "plate-1",
  print_id: "print-1",
  position: 0,
  url: "/print/1/plate/plate-1/file/model.3mf",
  filename: "model.3mf",
  mime: "model/3mf",
  size: 1024,
  format: {
    v: 1,
    kind: "bambu",
    app: "BambuStudio",
    appVersion: "02.03.00.70",
    orcaTag: null,
    printer: "Bambu Lab H2D 0.4 nozzle",
    nozzle: 0.4,
    filaments: 1,
    plates: 1,
    dialect: "bambu",
  },
};
const caps = { preview3d: true, openInSlicer: true, openInStudio: true, customize: false };
const file = {
  key: plate.id,
  url: plate.url,
  filename: "model.3mf",
  launchFilename: "model.3mf",
  index: 0,
  plate,
  caps,
};

function printer(id: string, preset: string | null): UserPrinter {
  return {
    printer: { id, brand: "bambulab", model: id, bed: null, height: null, nozzles: ["0.4"], extruders: 1 },
    brandName: "Bambu Lab",
    nozzle: "0.4",
    presets: { bambustudio: preset },
  };
}
const p1s = printer("bambulab-p1s", "Bambu Lab P1S 0.4 nozzle");
const h2d = printer("bambulab-h2d", "Bambu Lab H2D 0.4 nozzle");
const unknown = printer("someone-else", null);

describe("the copies a slicer gets", () => {
  it("wait for the user's printers in a slicer that loads a printer's presets, and aren't offered if reading failed", () => {
    expect(printersKnownFor("bambustudio", { loaded: false, failed: false })).toBe(false);
    expect(printersKnownFor("bambustudio", { loaded: true, failed: true })).toBe(false);
    expect(printersKnownFor("bambustudio", { loaded: true, failed: false })).toBe(true);
    // PrusaSlicer's copy isn't made for a printer, so it needs none of them.
    expect(printersKnownFor("prusaslicer", { loaded: false, failed: true })).toBe(true);
  });

  it("ask which printer when none is remembered and one of them would change the file", () => {
    const [target] = adaptedTargetsFor([file], "bambustudio", [], [p1s, h2d], null);
    expect(target).toMatchObject({ key: "adapted-plate-1", ask: true, printer: null });
    const forP1s = target.withPrinter?.(p1s);
    expect(forP1s && isAdaptedTarget(forP1s) && forP1s.printer?.id).toBe("bambulab-p1s");
    expect(forP1s?.href).toContain("adapted-for-bambustudio-bambulab-p1s-0.4");
  });

  it("open the file itself for the printer the project was made for, and nothing for one the slicer lacks", () => {
    const [target] = adaptedTargetsFor([file], "bambustudio", [], [p1s, h2d], null);
    const forH2d = target.withPrinter?.(h2d);
    expect(forH2d && isAdaptedTarget(forH2d)).toBe(false);
    expect(forH2d?.href).toBe(slicerHref("bambustudio", file, []));
    expect(target.withPrinter?.(unknown)).toBeNull();
  });

  it("are made for the remembered printer, and there's none for a project made for it", () => {
    const [forP1s] = adaptedTargetsFor([file], "bambustudio", [], [p1s, h2d], p1s);
    expect(forP1s).toMatchObject({ printer: { id: "bambulab-p1s", nozzle: "0.4" } });
    expect(forP1s.ask).toBeUndefined();
    expect(adaptedTargetsFor([file], "bambustudio", [], [p1s, h2d], h2d)).toEqual([]);
  });

  it("are made for the printer in QIDI Studio even when another app's project names it", () => {
    const q1 = { ...printer("qidi-q1pro", null), presets: { qidistudio: "Q1 Pro 0.4 nozzle" } };
    const forQ1 = { ...plate, format: { ...plate.format!, printer: "Q1 Pro 0.4 nozzle" } };
    const qidiFile = { ...file, plate: forQ1 };
    const [remembered] = adaptedTargetsFor([qidiFile], "qidistudio", [], [q1], q1);
    expect(remembered).toMatchObject({ printer: { id: "qidi-q1pro", nozzle: "0.4" } });
    expect(remembered.href).toContain("adapted-for-qidistudio-qidi-q1pro-0.4");
    expect(adaptedTargetsFor([qidiFile], "qidistudio", [], [q1], null)[0]).toMatchObject({ ask: true });
    const own = { ...qidiFile, plate: { ...forQ1, format: { ...forQ1.format, app: "QIDIStudio" } } };
    expect(adaptedTargetsFor([own], "qidistudio", [], [q1], q1)).toEqual([]);
  });
});

describe("the files a slicer is offered", () => {
  const offer = (openInSlicer: boolean) => ({ preview3d: false, openInSlicer, openInStudio: false, customize: false });
  const on = (filename: string, position: number, given?: ReturnType<typeof offer>): Plate => ({
    ...plate,
    id: `plate-${position}`,
    position,
    filename,
    url: `/print/1/plate/plate-${position}/file/${filename}`,
    format: null,
    ...(given ? { caps: given } : {}),
  });

  it("are the ones the server says Bridge opens, from every file of the model", () => {
    const print: Parameters<typeof modelFiles>[0] = {
      plates: [on("Part.stl", 0, offer(true)), on("Part.f3d", 1, offer(false)), on("Photo.png", 2, offer(false))],
      slicer_url: "/print/1/plate/plate-0/file/Part.stl",
      slicer_filename: "Part.stl",
      prepared_print: null,
    };
    const files = modelFiles(print);

    expect(files.map((entry) => entry.filename)).toEqual(["Part.stl", "Part.f3d", "Photo.png"]);
    expect(slicerFilesOf(files).map((entry) => entry.filename)).toEqual(["Part.stl"]);
  });

  it("are a prepared print of its own as the server says, and every file of an older backend's model", () => {
    const print: Parameters<typeof modelFiles>[0] = {
      plates: [on("Part.f3d", 0)],
      slicer_url: "/print/1/prepared-print",
      slicer_filename: "Tower.gco",
      prepared_print: { removable: true, caps: offer(false) },
    };

    expect(slicerFilesOf(modelFiles(print)).map((entry) => entry.filename)).toEqual(["Part.f3d"]);
  });
});
