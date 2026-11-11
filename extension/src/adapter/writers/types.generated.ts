// GENERATED from backend/src/adapter/writers/types.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type JSZip from "jszip";
import type { FlattenStats } from "./flatten.generated";

/** How the main model's XML goes into the zip: joined into one string by default; the backend streams it, since a
 *  big project's model is past what one string can hold. Returns whatever JSZip's file() takes. */
export type ModelContent = (xml: Generator<string>) => unknown;

export const joinModelXml: ModelContent = (xml) => Array.from(xml).join("");

export type WriteOptions = { modelContent?: ModelContent };

export type AdaptReport = {
  output: "bambu" | "prusa" | "cura";
  /** For a flattened copy, complete once the zip has been generated. */
  stats?: FlattenStats;
  /** The designer's settings the copy carries per object. */
  objectSettings?: number;
  /** For a Bambu layout copy: what changed. */
  retagged?: boolean;
  droppedOrcaTag?: boolean;
  translated?: boolean;
};

export type Written = { zip: JSZip; report: () => AdaptReport };
