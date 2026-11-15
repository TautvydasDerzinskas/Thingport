import type JSZip from "jszip";
import type { PrinterRecipe } from "../printer";
import type { FlattenStats } from "./flatten";

/** How the main model's XML goes into the zip: joined into one string by default; the backend streams it, since a
 *  big project's model is past what one string can hold. Returns whatever JSZip's file() takes. */
export type ModelContent = (xml: Generator<string>) => unknown;

export const joinModelXml: ModelContent = (xml) => Array.from(xml).join("");

export type WriteOptions = {
  modelContent?: ModelContent;
  /** The printer catalogue's word on the plan's printer (printer.ts); without it no copy is made for a printer. */
  printer?: PrinterRecipe | null;
};

export type AdaptReport = {
  output: "bambu" | "prusa" | "cura";
  /** A copy written from a PrusaSlicer project. */
  from?: "prusa";
  /** For a flattened copy, complete once the zip has been generated. */
  stats?: FlattenStats;
  /** The designer's settings the copy carries per object. */
  objectSettings?: number;
  /** For a Bambu layout copy: what changed. */
  retagged?: boolean;
  droppedOrcaTag?: boolean;
  translated?: boolean;
  /** For a copy made for a printer: the presets it names. */
  printer?: string | null;
  process?: string | null;
  filaments?: string[];
};

export type Written = { zip: JSZip; report: () => AdaptReport };
