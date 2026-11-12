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

const { adaptedTargetsFor, isAdaptedTarget, printersKnownFor, slicerHref } = await import("./useOpenInSlicer");

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
const file = { key: plate.id, url: plate.url, filename: "model.3mf", launchFilename: "model.3mf", index: 0, plate };

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
});
