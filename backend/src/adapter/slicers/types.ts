import type { ThreeMfKind } from "../format";
import type { SettingsDialect } from "../settings";

/**
 * What one slicer makes of a 3MF, which is all the planner (plan.ts) knows about it. A new slicer is a new file
 * beside this one, listed in index.ts.
 */
export type SlicerProfile = {
  /** Thingport's id for it, as the Slicer settings name it. */
  id: string;
  /** The kind of 3MF it reads best; a copy made for it is written as one. */
  reads: Extract<ThreeMfKind, "bambu" | "prusa" | "cura">;
  /** The apps whose files of that kind it opens as its own, settings and plates included. */
  ownApps: readonly string[];
  /** Also takes a Bambu layout file as its own when it carries an `OrcaSlicer` tag. */
  ownWithOrcaTag?: boolean;
  /** The newest version, per app, whose files it opens without a dialog; an app not listed, any. */
  quietUpTo?: Readonly<Record<string, string>>;
  /** The newest `OrcaSlicer` tag it opens without a dialog; unset, it never minds one. */
  orcaTagQuietUpTo?: string;
  /** Whose names it gives settings (Bambu layout only). */
  dialect?: SettingsDialect;
  /** Asks which printer to use for another maker's project and rebases the project on it, so such a project is
   *  left for it to do that. */
  asksForPrinter?: boolean;
  /** Loads a project's printer, process and filament presets by name, so a copy can name its presets for the
   *  user's printer (printer.ts). */
  targetsPrinter?: boolean;
};
