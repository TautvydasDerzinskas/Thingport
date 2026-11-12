// What Grab's "Download adapted" makes of a model's 3MF: the copy made for a slicer, and for a printer where one is
// picked (src/adapter, the same the web app opens), or, before a slicer is picked, the one PrusaSlicer and the like
// read. Runs in a worker where the page allows one, here otherwise (adapting/adapt.ts).

import JSZip from "jszip";
import {
  ADAPT_ZIP_OPTIONS,
  adapt3mf,
  classify3mf,
  planAdaptation,
  plainModelScanner,
  slicerProfile,
  type AdaptPlan,
  type PrinterChoice,
  type PrinterRecipe,
  type ThreeMfFormat,
} from "../adapter/index.generated";

/** The printer a copy is for, as Grab's catalogue describes it for the slicer (background/adaptSettings.ts). */
export type AdaptPrinterTarget = { choice: PrinterChoice; recipe: PrinterRecipe };

// Far more than the Application and OrcaSlicer tags at the top of a model file take.
const HEAD_BYTES = 64 * 1024;

export type AdaptOutcome = { bytes: Uint8Array; output: AdaptPlan["output"] | null };

type Scanner = ReturnType<typeof plainModelScanner>;

// A model file's text goes through the scanner in pieces this big, rather than as one string.
const SCAN_SLICE = 1024 * 1024;

async function scanEntry(file: JSZip.JSZipObject, scanner: Scanner): Promise<void> {
  const bytes = await file.async("uint8array");
  const decoder = new TextDecoder();
  for (let at = 0; at < bytes.length; at += SCAN_SLICE) {
    scanner.add(decoder.decode(bytes.subarray(at, at + SCAN_SLICE), { stream: true }));
  }
  scanner.add(decoder.decode());
  scanner.endFile();
}

/** What kind of 3MF the zip is, read as the backend reads a stored one: a plain one's colours included. */
export async function formatOfZip(zip: JSZip): Promise<ThreeMfFormat> {
  const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const named = (name: string) => entries.find((entry) => entry.toLowerCase() === name) ?? null;
  const text = async (name: string) => {
    const entry = named(name);
    return entry ? zip.file(entry)!.async("string") : null;
  };
  const root = named("3d/3dmodel.model");
  const head = root ? (await zip.file(root)!.async("uint8array")).subarray(0, HEAD_BYTES) : null;
  const files = {
    entries,
    modelHead: head ? new TextDecoder().decode(head) : null,
    projectSettings: await text("metadata/project_settings.config"),
    modelSettings: await text("metadata/model_settings.config"),
    prusaConfig: await text("metadata/slic3r_pe.config"),
  };
  const format = classify3mf(files);
  if (format.kind !== "plain" || !root) return format;
  const scanner = plainModelScanner();
  for (const entry of entries.filter((name) => /\.model$/i.test(name))) await scanEntry(zip.file(entry)!, scanner);
  return classify3mf({ ...files, plainModel: scanner.result() });
}

/** The copy for `slicer`, and `printer` where one is picked: null when the slicer opens the file as it is. Before a
 *  slicer is picked, or with one the adapter doesn't know, the copy PrusaSlicer gets, which most others read too. */
export function planFor(
  format: ThreeMfFormat,
  slicer: string | null,
  printer: PrinterChoice | null = null,
): AdaptPlan | null {
  return planAdaptation(format, slicerProfile(slicer) ?? slicerProfile("prusaslicer"), printer);
}

/** The adapted copy, or the file itself when `slicer` (and `printer`) need none. */
export async function adaptFile(
  input: Uint8Array,
  slicer: string | null,
  printer: AdaptPrinterTarget | null = null,
): Promise<AdaptOutcome> {
  const zip = await JSZip.loadAsync(input);
  const plan = planFor(await formatOfZip(zip), slicer, printer?.choice ?? null);
  if (!plan) return { bytes: input, output: null };
  const { zip: out } = await adapt3mf(zip, plan, printer ? { printer: printer.recipe } : {});
  return { bytes: await out.generateAsync({ type: "uint8array", ...ADAPT_ZIP_OPTIONS }), output: plan.output };
}
