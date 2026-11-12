# The printer catalogue

"Open adapted" makes a 3MF's copy for the slicer it's opened in, and for the printer it's printed on: Thingport needs
to know the printers the slicers know. The catalogue is every printer the slicers Thingport opens files in ship a
profile for (about a thousand): its bed, height and nozzles, its picture, and each slicer's own names for it and for
the process and filament presets it uses. It's built from those slicers' profiles and committed, so the server reads
it offline.

## How it fits together

```
scripts/printers/sources.json   the slicers, each pinned to a release
  └─ npm run printers:update ──▶ backend/assets/printers/   (committed; never edited by hand)
                                  ├─ index.json          every printer's summary: brand, model, bed, height, nozzles
                                  ├─ brands/<brand>.json a brand's printers in full, each slicer's preset names
                                  ├─ filaments/<slicer>.json  the filaments a slicer has for every printer
                                  ├─ names.json          every preset, model and definition name, as its printer
                                  ├─ covers/<id>.webp    pictures, 256 px at most
                                  └─ SOURCES.md          each source's release, commit and licence
backend/src/printers/catalogue.ts   reads it as asked for: the index once, a brand when one of its printers is wanted
```

The generator (`scripts/printers/`) fetches each source's profile folders at its release, as a shallow sparse checkout
in a cache outside the repo (`PRINTER_SOURCES`, the OS temp folder by default), and reads them:

- **`lib/orca.mjs`**: OrcaSlicer's format, which Bambu Studio and the slicers built on them use too. A vendor's
  `<Vendor>.json` lists its printer models; `machine/`, `process/` and `filament/` hold the presets, each
  `inherits`-ing a parent. Each printer preset gets the filaments made for it: the one to name for each filament type
  (a generic where there is one) and for each product, a preset's name without the printer it's tuned for ("Bambu PLA
  Basic"). Products go by name because the slicers give one product different ids. Filaments that go with every
  printer, as OrcaSlicer's filament library does, are written once per slicer, in `filaments/`.
- **`lib/prusa.mjs`**: PrusaSlicer's vendor bundles (`<Vendor>.ini`), whose presets may inherit several parents.
- **`lib/cura.mjs`**: Cura's machine definitions, which inherit down to `fdmprinter`.
- **`lib/condition.mjs`**: the `compatible_printers_condition` language presets use to say which printers they fit,
  parsed rather than evaluated.

A copy for a printer (`backend/src/adapter/printer.ts`) names these presets, and `backend/src/printers/targets.ts`
reads what it needs for one printer in one slicer.

`lib/merge.mjs` makes one entry of each printer's records (`lib/identity.mjs` says which records are the same printer:
the brand from a table of spellings, the model name without the brand and without setups like "Combo" or "MMU3").
Its facts come from the best source for it: the maker's own slicer, then OrcaSlicer, the other makers' slicers, Bambu
Studio's copies of other brands' printers, PrusaSlicer, Cura. Every slicer's own preset names are kept, so a copy can
name the preset the user's slicer has for their printer.

## Updating it

1. Bump a source's `ref` in `scripts/printers/sources.json` to its new release.
2. Run `npm run printers:update`. It prints what it read, then a line with the printer count, pictures and how many
   beds and heights the sources disagree on; the report, with each source's problems, is in the cache folder.
3. Run the backend's `tests/printerCatalogue.test.ts`, then commit `backend/assets/printers/` with the source change.

A printer whose id changes (a renamed model) is a new printer to anything that stored the old id, so look at ids
that disappear before committing.

## Adding a slicer

Add it to `sources.json`: `format` is `orca`, `prusa` or `cura`, `paths` the folders the profiles are in, `id`
Thingport's slicer id when Thingport opens files in it, and `brand` when it's that maker's own slicer, whose data for
their printers comes first. Use a release of the slicer's own repository, and check its licence: profiles are taken
from the slicers' AGPL and LGPL releases, never from a settings repository without a licence.

When records of one printer don't come together, prefer a rule in `lib/identity.mjs` that explains the difference;
`ALIAS_OVERLAY` is for renames no rule can infer, and should stay short.
