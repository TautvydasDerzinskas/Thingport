// Grab's copy of the printer catalogue (public/printers, cut from the server's by scripts/sync-printers.mjs): every
// printer, to list and draw, and what a copy for one needs in the slicers that load a printer's presets by name. The
// background alone reads it, and a brand's file only when a copy for one of its printers is made. The recipe comes
// from the adapter, as the server's does, so a copy names the same presets whichever made it.

import {
  printerRecipe,
  type FilamentChoices,
  type PrinterChoice,
  type PrinterPreset,
  type PrinterRecipe,
  type ProcessPreset,
  type RecipePrinter,
  type SlicerEntry,
} from "../adapter/index.generated";

/** The files' shape this Grab reads: GRAB_CATALOGUE_VERSION in scripts/sync-printers.mjs. */
export const CATALOGUE_VERSION = 1;

export type CatalogueBrand = { id: string; name: string; printers: number };

/** A printer as Grab lists and draws it; `slicers` are those of the index's that have a preset for it. */
export type CataloguePrinter = {
  id: string;
  brand: string;
  model: string;
  bed: { shape: "rectangle" | "circle" | "polygon"; x: number; y: number } | null;
  height: number | null;
  nozzles: string[];
  extruders: number;
  slicers?: string[];
};

/** `slicers`: the ones that load a printer's presets by name; `filaments`: those with filaments for every printer. */
export type CatalogueIndex = {
  version: number;
  slicers: string[];
  filaments: string[];
  brands: CatalogueBrand[];
  printers: CataloguePrinter[];
};

type PooledPreset = { name: string; defaultProcess?: string; processes?: number; filaments?: number };
type PooledEntry = Omit<SlicerEntry, "presets"> & { presets: Record<string, PooledPreset[]> };

/** A brand's printers, their presets naming the process lists and filament maps they share by index. */
export type BrandFile = {
  version: number;
  processes: ProcessPreset[][];
  filaments: FilamentChoices[];
  printers: Record<string, Omit<RecipePrinter, "id" | "slicers"> & { slicers: Record<string, PooledEntry[]> }>;
};

/** A brand file's printers with their presets' shared lists put back. */
export function unpackBrand(file: BrandFile): Map<string, RecipePrinter> {
  const printers = new Map<string, RecipePrinter>();
  for (const [id, packed] of Object.entries(file.printers)) {
    const slicers: Record<string, SlicerEntry[]> = {};
    for (const [slicer, entries] of Object.entries(packed.slicers)) {
      slicers[slicer] = entries.map((entry) => ({
        ...entry,
        presets: Object.fromEntries(
          Object.entries(entry.presets).map(([nozzle, presets]) => [
            nozzle,
            presets.map(
              ({ processes, filaments, ...preset }) =>
                ({
                  ...preset,
                  ...(processes === undefined ? {} : { processes: file.processes[processes] }),
                  ...(filaments === undefined ? {} : { filaments: file.filaments[filaments] }),
                }) as PrinterPreset,
            ),
          ]),
        ),
      }));
    }
    printers.set(id, { id, extruders: packed.extruders, bed: packed.bed, height: packed.height, slicers });
  }
  return printers;
}

/** One of the catalogue's files, by its path under public/printers. */
export type ReadFile = (file: string) => Promise<unknown>;

async function readPackaged(file: string): Promise<unknown> {
  const res = await fetch(chrome.runtime.getURL(`printers/${file}`));
  if (!res.ok) throw new Error(`printers/${file}: ${res.status}`);
  return res.json();
}

export type PrinterCatalogue = ReturnType<typeof printerCatalogue>;

/** The catalogue, each file read once; one that fails to read is tried again next time. */
export function printerCatalogue(read: ReadFile = readPackaged) {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(file: string, parse: (value: unknown) => T): Promise<T> => {
    let pending = cache.get(file) as Promise<T> | undefined;
    if (!pending) {
      pending = read(file).then(parse);
      pending.catch(() => cache.delete(file));
      cache.set(file, pending);
    }
    return pending;
  };
  const index = () =>
    once("index.json", (value) => {
      const parsed = value as CatalogueIndex;
      return { ...parsed, byId: new Map(parsed.printers.map((p) => [p.id, p])) };
    });
  const brand = (id: string) => once(`brands/${id}.json`, (value) => unpackBrand(value as BrandFile));
  const everyPrinter = (slicer: string) =>
    once(`filaments/${slicer}.json`, (value) => {
      const { types, products } = value as FilamentChoices;
      return { types, products };
    });

  return {
    index,
    /** What a copy for the printer and nozzle needs in `slicer`: null for a printer Grab doesn't know, or one the
     *  slicer has no preset for, which then gets the copy for the slicer alone. */
    async recipe(
      slicer: string,
      printerId: string,
      nozzle: string,
    ): Promise<{ choice: PrinterChoice; recipe: PrinterRecipe } | null> {
      const { byId, filaments } = await index();
      const summary = byId.get(printerId);
      if (!summary?.slicers?.includes(slicer)) return null;
      const found = (await brand(summary.brand)).get(printerId);
      if (!found) return null;
      return printerRecipe(slicer, found, nozzle, filaments.includes(slicer) ? await everyPrinter(slicer) : null);
    },
  };
}
