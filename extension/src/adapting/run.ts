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

// A plain 3MF's colours can be anywhere in its models, after meshes; past this much of them unzipped, as the server
// reads them (services/threeMfFormat.ts), they're left uncounted.
export const PLAIN_SCAN_BYTES = 512 * 1024 * 1024;

// JSZip's own stream of an entry as it's unzipped, which its types leave out.
type Streamable = { internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array> };

/** An entry as it's unzipped, a piece at a time, never held whole: `each` says whether to go on. Resolves once it's
 *  read through or stopped. */
function streamEntry(file: JSZip.JSZipObject, each: (chunk: Uint8Array) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = (file as unknown as Streamable).internalStream("uint8array");
    let done = false;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
    stream
      .on("data", (chunk) => {
        if (done || each(chunk)) return;
        stream.pause();
        finish();
      })
      .on("error", finish)
      .on("end", () => finish())
      .resume();
  });
}

/** The first `bytes` of an entry, unzipping no more of it than that takes. */
async function headOf(file: JSZip.JSZipObject, bytes: number): Promise<Uint8Array> {
  const out = new Uint8Array(bytes);
  let at = 0;
  await streamEntry(file, (chunk) => {
    const part = chunk.subarray(0, bytes - at);
    out.set(part, at);
    at += part.length;
    return at < bytes;
  });
  return out.subarray(0, at);
}

/** A model file through the scanner as it's unzipped; false where `budget.left` ran out first. */
async function scanEntry(file: JSZip.JSZipObject, scanner: Scanner, budget: { left: number }): Promise<boolean> {
  const decoder = new TextDecoder();
  let whole = true;
  await streamEntry(file, (chunk) => {
    budget.left -= chunk.length;
    if (budget.left < 0) return (whole = false);
    scanner.add(decoder.decode(chunk, { stream: true }));
    return true;
  });
  if (!whole) return false;
  scanner.add(decoder.decode());
  scanner.endFile();
  return true;
}

/** What kind of 3MF the zip is, read as the backend reads a stored one: a plain one's colours included, unless its
 *  models unzip to more than `scanBytes`. */
export async function formatOfZip(zip: JSZip, scanBytes = PLAIN_SCAN_BYTES): Promise<ThreeMfFormat> {
  const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const named = (name: string) => entries.find((entry) => entry.toLowerCase() === name) ?? null;
  const text = async (name: string) => {
    const entry = named(name);
    return entry ? zip.file(entry)!.async("string") : null;
  };
  const root = named("3d/3dmodel.model");
  const head = root ? await headOf(zip.file(root)!, HEAD_BYTES) : null;
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
  const budget = { left: scanBytes };
  for (const entry of entries.filter((name) => /\.model$/i.test(name))) {
    if (!(await scanEntry(zip.file(entry)!, scanner, budget))) return classify3mf({ ...files, plainModel: null });
  }
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
