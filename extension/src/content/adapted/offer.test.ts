import { describe, expect, it } from "vitest";
import { CREALITYCLOUD_ADAPT } from "../../providers/crealitycloud/adaptSite";
import { MAKERWORLD_ADAPT } from "../../providers/makerworld/adaptSite";
import { NEXPRINT_ADAPT } from "../../providers/nexprint/adaptSite";
import { PRINTABLES_ADAPT } from "../../providers/printables/adaptSite";
import { SNAPMAKER_ADAPT } from "../../providers/snapmaker/adaptSite";
import { DEFAULT_TARGET, type AdaptTarget, type TargetPrinter } from "../../shared/adaptTargets";
import { copiesFor, explanation, outputsFor, savedNote } from "./offer";

const P1S: TargetPrinter = {
  id: "bambulab-p1s",
  brandName: "Bambu Lab",
  model: "P1S",
  nozzle: "0.4",
  bed: { shape: "rectangle", x: 256, y: 256 },
  height: 250,
  extruders: 1,
};
const target = (slicer: string, printer: TargetPrinter | null = null): AdaptTarget => ({
  key: printer ? `${slicer}|${printer.id}|${printer.nozzle}` : slicer,
  slicer,
  printer,
});

describe("Download adapted's copies of MakerWorld's files", () => {
  it("are made for every slicer that mis-reads Bambu Studio projects, and for a printer in Bambu Studio itself", () => {
    expect(outputsFor(MAKERWORLD_ADAPT, target("bambustudio"))).toEqual([]);
    expect(outputsFor(MAKERWORLD_ADAPT, target("bambustudio", P1S))).toEqual(["bambu"]);
    expect(outputsFor(MAKERWORLD_ADAPT, target("prusaslicer"))).toEqual(["prusa"]);
    expect(outputsFor(MAKERWORLD_ADAPT, target("cura"))).toEqual(["cura"]);
    expect(outputsFor(MAKERWORLD_ADAPT, DEFAULT_TARGET)).toEqual(["prusa"]);
  });

  it("leave out a slicer that opens them as they are", () => {
    const offered = copiesFor(MAKERWORLD_ADAPT, [target("bambustudio"), target("bambustudio", P1S), target("cura")]);
    expect(offered.map((t) => t.key)).toEqual(["bambustudio|bambulab-p1s|0.4", "cura"]);
  });

  it("say what each keeps", () => {
    const forPrinter = explanation(MAKERWORLD_ADAPT, target("bambustudio", P1S));
    expect(forPrinter).toContain("your Bambu Lab P1S with its 0.4 mm nozzle in Bambu Studio");
    expect(forPrinter).toContain("lays the plates out on its bed");
    expect(explanation(MAKERWORLD_ADAPT, target("cura"))).toContain("Cura doesn't read painted colors");
    expect(explanation(MAKERWORLD_ADAPT, target("prusaslicer"))).toMatch(
      /^MakerWorld's files are Bambu Studio projects, which PrusaSlicer often opens/,
    );
    const unpicked = explanation(MAKERWORLD_ADAPT, DEFAULT_TARGET);
    expect(unpicked).toContain("PrusaSlicer, Cura and other slicers often open");
    expect(unpicked).toContain("Pick your slicer in Grab's Adapt 3MFs settings");
  });
});

describe("Download adapted's copies of Printables' files", () => {
  it("are offered for any slicer one of its kinds of 3MF needs a copy for", () => {
    // A PrusaSlicer project for the Bambu family, a Bambu one or a plain one in colours for PrusaSlicer.
    expect(outputsFor(PRINTABLES_ADAPT, target("bambustudio"))).toEqual(["bambu"]);
    expect(outputsFor(PRINTABLES_ADAPT, target("prusaslicer"))).toEqual(["prusa"]);
    expect(outputsFor(PRINTABLES_ADAPT, target("cura"))).toEqual(["cura"]);
    expect(outputsFor(PRINTABLES_ADAPT, DEFAULT_TARGET)).toEqual(["prusa"]);
    const all = [target("bambustudio"), target("orcaslicer"), target("prusaslicer"), target("cura")];
    expect(copiesFor(PRINTABLES_ADAPT, all)).toEqual(all);
  });

  it("say the copy is made from whichever kind the file is, or is the file itself", () => {
    const bambu = explanation(PRINTABLES_ADAPT, target("bambustudio"));
    expect(bambu).toMatch(/^3MFs on Printables come from PrusaSlicer, Bambu Studio and other apps\. /);
    expect(bambu).toContain("a copy Bambu Studio opens as its own project");
    expect(bambu).toContain("Where Bambu Studio opens the file as it is, you get the file itself.");
    expect(explanation(PRINTABLES_ADAPT, target("orcaslicer", P1S))).toContain(
      "your Bambu Lab P1S with its 0.4 mm nozzle in OrcaSlicer",
    );
    const unpicked = explanation(PRINTABLES_ADAPT, DEFAULT_TARGET);
    expect(unpicked).toContain("Where PrusaSlicer opens the file as it is");
    expect(unpicked).toContain("Pick your slicer in Grab's Adapt 3MFs settings");
  });

  it("say what's worth knowing about a saved copy", () => {
    const asIs = { copy: false, printerless: false, nozzle: null };
    expect(savedNote(target("prusaslicer"), asIs)).toBe("Downloaded the file itself: PrusaSlicer opens it as it is.");
    expect(savedNote(DEFAULT_TARGET, asIs)).toBe("Downloaded the file itself: PrusaSlicer opens it as it is.");
    expect(savedNote(target("bambustudio", P1S), { copy: true, printerless: true, nozzle: null })).toBe(
      "Grab has no Bambu Studio preset for the Bambu Lab P1S, so this copy keeps the designer's printer. Pick yours " +
        "in Bambu Studio before slicing.",
    );
    expect(savedNote(target("bambustudio", P1S), { copy: false, printerless: true, nozzle: null })).toBe(
      "Grab has no Bambu Studio preset for the Bambu Lab P1S, so the file itself, which Bambu Studio opens as it is, " +
        "keeps the designer's printer. Pick yours in Bambu Studio before slicing.",
    );
    const wide = target("bambustudio", { ...P1S, nozzle: "0.6" });
    expect(savedNote(wide, { copy: true, printerless: false, nozzle: "0.4" })).toBe(
      "Bambu Studio has no 0.6 mm nozzle preset for the Bambu Lab P1S, so this copy names its 0.4 mm one. Set your " +
        "nozzle in Bambu Studio before slicing.",
    );
    expect(savedNote(target("bambustudio", P1S), { copy: true, printerless: false, nozzle: null })).toBeNull();
    expect(savedNote(target("cura"), { copy: true, printerless: false, nozzle: null })).toBeNull();
  });
});

describe("Download adapted's copies for QIDI Studio", () => {
  const Q1: TargetPrinter = { ...P1S, id: "qidi-q1pro", brandName: "QIDI", model: "Q1 Pro", bed: null };

  it("are made only for a printer of a Bambu Studio project, which it opens on its own printer", () => {
    expect(outputsFor(MAKERWORLD_ADAPT, target("qidistudio"))).toEqual([]);
    expect(outputsFor(MAKERWORLD_ADAPT, target("qidistudio", Q1))).toEqual(["bambu"]);
    // Another app's project would open without its settings.
    expect(outputsFor(CREALITYCLOUD_ADAPT, target("qidistudio"))).toEqual(["bambu"]);
  });

  it("say it puts a copy that isn't for a printer on the one selected in it", () => {
    const own = explanation(CREALITYCLOUD_ADAPT, target("qidistudio"));
    expect(own).toContain("under the names QIDI Studio gives them");
    expect(own).toContain("QIDI Studio puts it on the printer selected in it");
    expect(explanation(PRINTABLES_ADAPT, target("qidistudio"))).toContain("on the printer selected in QIDI Studio");
    expect(explanation(MAKERWORLD_ADAPT, target("qidistudio", Q1))).toContain(
      "your QIDI Q1 Pro with its 0.4 mm nozzle in QIDI Studio",
    );
    expect(savedNote(target("qidistudio", P1S), { copy: false, printerless: true, nozzle: null })).toBe(
      "Grab has no QIDI Studio preset for the Bambu Lab P1S, so QIDI Studio puts the file itself on the printer " +
        "selected in it. Pick yours there before slicing.",
    );
  });
});

/** The slicers among `slicers` a site's files get a copy for. */
const offered = (site: Parameters<typeof outputsFor>[0], slicers: string[]) =>
  slicers.filter((slicer) => outputsFor(site, target(slicer)).length > 0);

describe("Download adapted's copies of the files of the sites whose own slicer wrote them", () => {
  const slicers = ["crealityprintlink", "snapmaker-orca", "elegooslicer", "orcaslicer", "bambustudio", "prusaslicer"];

  it("leave out the slicer that wrote them, and the ones that open its projects as they are", () => {
    expect(offered(CREALITYCLOUD_ADAPT, slicers)).toEqual([
      "snapmaker-orca",
      "elegooslicer",
      "orcaslicer",
      "bambustudio",
      "prusaslicer",
    ]);
    expect(offered(SNAPMAKER_ADAPT, slicers)).not.toContain("snapmaker-orca");
    expect(offered(SNAPMAKER_ADAPT, slicers)).toContain("bambustudio");
    // Elegoo Slicer 1.5.3 tags its projects for OrcaSlicer too.
    expect(offered(NEXPRINT_ADAPT, slicers)).not.toContain("elegooslicer");
    expect(offered(NEXPRINT_ADAPT, slicers)).not.toContain("orcaslicer");
    expect(offered(NEXPRINT_ADAPT, slicers)).toContain("bambustudio");
  });

  it("say what the site's files are", () => {
    expect(explanation(CREALITYCLOUD_ADAPT, target("prusaslicer"))).toMatch(
      /^Creality Cloud's files are Creality Print/,
    );
    expect(explanation(NEXPRINT_ADAPT, target("cura"))).toMatch(/^NexPrint's files are Elegoo Slicer projects/);
  });
});
