// The 3MF adapter: copies of a model's 3MF made for the slicer it's opened in, so it opens there as if it had been
// made there. format.ts says what a file is, slicers/ what each slicer reads, plan.ts what copy that takes, and
// writers/ make it. Runs as is in the browser too: nothing here may import from Node.
//
// This folder is the source; scripts/sync-adapter.mjs copies it where else it runs.

import type JSZip from "jszip";
import type { AdaptPlan } from "./plan";
import { readBambuPackage } from "./readers/bambuProject";
import { readPlainPackage } from "./readers/plainProject";
import { readPrusaPackage } from "./readers/prusaProject";
import { writeBambu } from "./writers/bambu";
import { writeBambuFromPrusa } from "./writers/bambuFromPrusa";
import { writeCura } from "./writers/cura";
import { writePrusa } from "./writers/prusa";
import type { WriteOptions, Written } from "./writers/types";

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

export { classify3mf, FORMAT_VERSION, parseGenerator, storedFormat } from "./format";
export type { PlainModelScan, ThreeMfFiles, ThreeMfFormat, ThreeMfKind } from "./format";
export { COMPATIBLE_TAG, madeFor, planAdaptation, planKey, versionAtMost } from "./plan";
export type { AdaptPlan, PrinterChoice } from "./plan";
export type { FilamentChoices, PrinterRecipe } from "./printer";
export { SLICER_PROFILES, slicerProfile } from "./slicers";
export type { SlicerProfile } from "./slicers";
export type { AdaptReport, WriteOptions, Written } from "./writers/types";
