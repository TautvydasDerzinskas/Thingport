// Download adapted's one job, wherever it's started (the page's buttons or the bubble's rows): download one of the
// model's 3MFs as the site's own button would, make the copy for the chosen slicer and printer in this tab, and save it. The
// file goes nowhere but the downloads folder.

import { adaptBytes } from "../../adapting/adapt";
import type { AdaptTarget } from "../../shared/adaptTargets";
import { request } from "../../shared/messages";
import { adaptingPhrases, rotatePhrases } from "../panels/funStatus";
import type { AdaptFile, AdaptSite } from "./site";

// Converting holds the file, its unzipped model XML and the result in memory at once.
export const MAX_BYTES = 50 * 1024 * 1024;
const MB = 1024 * 1024;

/** "MakerWorld's", "Printables'". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** A name the downloads folder takes. */
export const safeFilename = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_");

export function tooBig(bytes: number, site: string): Error {
  return new Error(
    `This file is ${Math.round(bytes / MB)} MB, too big to adapt in the browser (the limit is ${MAX_BYTES / MB} MB). ` +
      `Use ${possessive(site)} regular Download instead.`,
  );
}

/** The body, stopping at MAX_BYTES, with "Downloading 3.1 of 12.0 MB…" as it comes. */
export async function readBody(
  res: Response,
  declared: number | null,
  site: string,
  onProgress: (text: string) => void,
): Promise<ArrayBuffer> {
  const reader = res.body?.getReader();
  if (!reader) return res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      void reader.cancel();
      throw tooBig(declared ?? received, site);
    }
    chunks.push(value);
    const got = (received / MB).toFixed(1);
    onProgress(declared ? `Downloading ${got} of ${(declared / MB).toFixed(1)} MB…` : `Downloading ${got} MB…`);
  }
  return new Blob(chunks as BlobPart[]).arrayBuffer();
}

/** A site's file from its file server: refused where the server says no, or `refused` says what came isn't the file,
 *  and stopped past MAX_BYTES, saying how it's going through `progress`. */
export async function fetchFile(
  url: string,
  site: string,
  progress: (text: string) => void,
  { init, refused }: { init?: RequestInit; refused?: (res: Response) => boolean } = {},
): Promise<{ res: Response; bytes: ArrayBuffer }> {
  const res = await fetch(url, init);
  if (!res.ok || refused?.(res)) {
    void res.body?.cancel();
    throw new Error(`${possessive(site)} file server refused the download (${res.status}). Try again in a moment.`);
  }
  const declared = Number(res.headers.get("Content-Length")) || null;
  if (declared && declared > MAX_BYTES) {
    void res.body?.cancel();
    throw tooBig(declared, site);
  }
  return { res, bytes: await readBody(res, declared, site, progress) };
}

/** From Content-Disposition, else the URL's last path segment. */
export function sourceFilename(res: Response, url: string): string {
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let name = "";
  try {
    name = decodeURIComponent(encoded ?? plain ?? new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    name = plain ?? "";
  }
  return safeFilename(name).trim() || "model.3mf";
}

/** `<name>-adapted.3mf`, and the printer's model after it for a copy made for one. */
export function copyFilename(source: string, target: AdaptTarget): string {
  const base = source.replace(/\.3mf$/i, "");
  const printer = target.printer?.model
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${base}-adapted${printer ? `-${printer}` : ""}.3mf`;
}

function saveFile(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "model/3mf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** What was saved: a copy, or the file itself where the slicer opens it as it is. `printerless` when Grab has no
 *  preset of the slicer for the printer, so the copy is the slicer's alone; `nozzle` the nozzle whose preset it names
 *  when the slicer has none for the printer's own, which it takes the nearest of. */
export type Saved = { copy: boolean; printerless: boolean; nozzle: string | null };

export async function downloadAdapted(
  site: AdaptSite,
  pageUrl: string,
  source: AdaptFile,
  target: AdaptTarget,
  progress: (text: string) => void,
): Promise<Saved> {
  const file = await site.download(pageUrl, source, progress);
  // Grab not having the printer's preset makes a copy for the slicer alone; not managing to look is a failure.
  const printer =
    target.printer && target.slicer
      ? await request("GET_PRINTER_RECIPE", {
          slicer: target.slicer,
          printerId: target.printer.id,
          nozzle: target.printer.nozzle,
        }).catch((err: unknown) => {
          throw new Error("Couldn't read Grab's printer list to make this copy. Try again in a moment.", {
            cause: err,
          });
        })
      : null;
  const stop = rotatePhrases(adaptingPhrases, progress);
  let adapted: Awaited<ReturnType<typeof adaptBytes>>;
  try {
    adapted = await adaptBytes(file.bytes, target.slicer, printer).finally(stop);
  } catch (err) {
    const expected = `a 3MF project ${possessive(site.name)} Download gives`;
    throw new Error(`Couldn't adapt this file: it doesn't look like ${expected}.`, { cause: err });
  }
  saveFile(adapted.bytes, adapted.output ? copyFilename(file.filename, target) : file.filename);
  const nozzle = printer?.choice.nozzle;
  return {
    copy: adapted.output !== null,
    printerless: Boolean(target.printer && !printer),
    nozzle: adapted.output && nozzle && nozzle !== target.printer?.nozzle ? nozzle : null,
  };
}
