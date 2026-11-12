// GENERATED from backend/src/adapter/index.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// The 3MF adapter: copies of a model's 3MF made for the slicer it's opened in, so it opens there as if it had been
// made there. format.ts says what a file is, slicers/ what each slicer reads, plan.ts what copy that takes, and
// writers/ make it. Runs as is in the browser too: nothing here may import from Node.
//
// This folder is the source; scripts/sync-adapter.mjs copies it where else it runs.

import type JSZip from "jszip";
import type { AdaptPlan } from "./plan.generated";
import { readBambuPackage } from "./readers/bambuProject.generated";
import { readPlainPackage } from "./readers/plainProject.generated";
import { readPrusaPackage } from "./readers/prusaProject.generated";
import { writeBambu } from "./writers/bambu.generated";
import { writeBambuFromPrusa } from "./writers/bambuFromPrusa.generated";
import { writeCura } from "./writers/cura.generated";
import { writePrusa } from "./writers/prusa.generated";
import type { WriteOptions, Written } from "./writers/types.generated";

/** Bumped whenever a writer's output changes, so copies made by an older one are made again. */
export const ADAPTER_VERSION = 4;

export const ADAPT_ZIP_OPTIONS = { compression: "DEFLATE", compressionOptions: { level: 6 } } as const;

/** The copy `plan` describes, of a Bambu layout 3MF, a PrusaSlicer project or a plain 3MF, as a zip still to be
 *  generated. */
export async function adapt3mf(
  input: Uint8Array | ArrayBuffer | JSZip,
  plan: AdaptPlan,
  options: WriteOptions = {},
): Promise<Written> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (plan.output === "bambu" && plan.from === "prusa")
    return writeBambuFromPrusa(await readPrusaPackage(bytes), plan, options.printer);
  const pkg =
    plan.output !== "bambu" && plan.from === "plain" ? await readPlainPackage(bytes) : await readBambuPackage(bytes);
  if (plan.output === "prusa") return writePrusa(pkg, options);
  if (plan.output === "cura") return writeCura(pkg, options);
  return writeBambu(pkg, plan, options.printer);
}

export { classify3mf, FORMAT_VERSION, parseGenerator, storedFormat } from "./format.generated";
export type { PlainModelScan, ThreeMfFiles, ThreeMfFormat, ThreeMfKind } from "./format.generated";
export { COMPATIBLE_TAG, madeFor, planAdaptation, planKey, versionAtMost } from "./plan.generated";
export type { AdaptPlan, PrinterChoice } from "./plan.generated";
export type { FilamentChoices, PrinterRecipe } from "./printer.generated";
export { SLICER_PROFILES, slicerProfile } from "./slicers/index.generated";
export type { SlicerProfile } from "./slicers/index.generated";
export type { AdaptReport, WriteOptions, Written } from "./writers/types.generated";
