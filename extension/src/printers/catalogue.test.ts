import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SLICER_PROFILES, printerRecipe, type FilamentChoices, type RecipePrinter } from "../adapter/index.generated";
import { CATALOGUE_VERSION, printerCatalogue, type CatalogueIndex } from "./catalogue";

// Grab's copy against the server's catalogue it was cut from (the repository's, as CI checks out).
const GRAB = path.resolve(__dirname, "../../public/printers");
const SERVER = path.resolve(__dirname, "../../../backend/assets/printers");
const json = (dir: string, file: string): unknown => JSON.parse(readFileSync(path.join(dir, file), "utf8"));
const catalogue = () => printerCatalogue(async (file) => json(GRAB, file));

describe("Grab's printer catalogue", () => {
  it("is in the shape this Grab reads", async () => {
    const index = await catalogue().index();
    expect(index.version).toBe(CATALOGUE_VERSION);
    for (const file of readdirSync(path.join(GRAB, "brands"))) {
      expect((json(path.join(GRAB, "brands"), file) as { version: number }).version).toBe(CATALOGUE_VERSION);
    }
  });

  it("carries the slicers that load a printer's presets by name", async () => {
    const index = await catalogue().index();
    const wanted = Object.values(SLICER_PROFILES)
      .filter((profile) => profile.targetsPrinter)
      .map((profile) => profile.id);
    expect(index.slicers).toEqual(wanted.toSorted());
  });

  it("lists every printer the server's does, as the server describes it", async () => {
    const index = await catalogue().index();
    const server = json(SERVER, "index.json") as Pick<CatalogueIndex, "brands" | "printers">;
    expect(index.brands).toEqual(server.brands);
    expect(index.printers.map((p) => p.id)).toEqual(server.printers.map((p) => p.id));
    const byId = new Map(server.printers.map((p) => [p.id, p]));
    for (const p of index.printers) {
      const theirs = byId.get(p.id)!;
      expect([p.brand, p.model, p.height, p.nozzles, p.extruders]).toEqual([
        theirs.brand,
        theirs.model,
        theirs.height,
        theirs.nozzles,
        theirs.extruders,
      ]);
      expect(p.bed).toEqual(theirs.bed && { shape: theirs.bed.shape, x: theirs.bed.x, y: theirs.bed.y });
    }
  });

  it("makes the server's recipe for every printer, slicer and nozzle", async () => {
    const grab = catalogue();
    const { slicers } = await grab.index();
    const everyPrinter = new Map<string, FilamentChoices | null>(
      slicers.map((slicer) => {
        const file = path.join(SERVER, "filaments", `${slicer}.json`);
        try {
          const { types, products } = JSON.parse(readFileSync(file, "utf8")) as FilamentChoices;
          return [slicer, { types, products }];
        } catch {
          return [slicer, null];
        }
      }),
    );
    let made = 0;
    for (const file of readdirSync(path.join(SERVER, "brands"))) {
      const { printers } = json(path.join(SERVER, "brands"), file) as { printers: RecipePrinter[] };
      for (const printer of printers) {
        for (const slicer of slicers) {
          const listed = printer.slicers[slicer]?.flatMap((entry) => Object.keys(entry.presets ?? {})) ?? [];
          // Each nozzle it has, one it hasn't (the nearest stands in) and one that isn't a number.
          for (const nozzle of new Set([...listed, "0.5", "HF0.4"])) {
            const theirs = printerRecipe(slicer, printer, nozzle, everyPrinter.get(slicer) ?? null);
            expect(await grab.recipe(slicer, printer.id, nozzle), `${printer.id} ${slicer} ${nozzle}`).toEqual(theirs);
            if (theirs) made++;
          }
        }
      }
    }
    expect(made).toBeGreaterThan(1000);
  });

  it("has nothing for a printer it doesn't know or a slicer with no preset for it", async () => {
    const grab = catalogue();
    expect(await grab.recipe("bambustudio", "no-such-printer", "0.4")).toBeNull();
    expect(await grab.recipe("bambustudio", "prusaresearch-coreone", "0.4")).toBeNull();
    expect(await grab.recipe("cura", "bambulab-p1s", "0.4")).toBeNull();
    expect((await grab.recipe("bambustudio", "bambulab-p1s", "0.4"))?.choice.preset).toBe("Bambu Lab P1S 0.4 nozzle");
  });

  it("reads a file again after it failed to", async () => {
    let fail = true;
    const grab = printerCatalogue(async (file) => {
      if (fail) throw new Error("offline");
      return json(GRAB, file);
    });
    await expect(grab.index()).rejects.toThrow("offline");
    fail = false;
    expect((await grab.index()).printers.length).toBeGreaterThan(900);
  });
});
