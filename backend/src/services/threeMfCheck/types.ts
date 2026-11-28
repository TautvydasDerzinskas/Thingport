// What a site needs of a 3MF before it takes it as a print profile, and what Thingport changes in the copy it uploads
// for it. A provider names what its site needs (ProviderBackend.publishThreeMf); check.ts finds what a file lacks.

/** The checks there are, each finding one or more problems. `sliced` and `project` run whatever a site lists, as the
 *  others read the file as its slicer's project. */
export type ThreeMfCheckId = "sliced" | "project" | "nozzle" | "overlapping-objects" | "wipe-tower" | "off-bed";

export type ThreeMfRules = {
  /** The slicer the site opens uploads in (an adapter/slicers/ profile id): the copy is its project. */
  slicer: string;
  /** The printer catalogue's brand whose printers its print profiles are for. */
  brand: string;
  checks: readonly ThreeMfCheckId[];
};

export type ThreeMfProblem =
  /** Not a 3MF Thingport can read: not a zip, or no model in it. */
  | "unreadable"
  /** It carries G-code: a print, not a project. */
  | "sliced"
  /** A plain 3MF or a Cura project, with no slicer settings to publish. */
  | "not-a-project"
  /** Another slicer's project (PrusaSlicer's). */
  | "other-slicer"
  /** The slicer's own layout written by another app (OrcaSlicer), whose settings the slicer doesn't load. */
  | "other-app"
  /** Made for a printer not of the brand, or one the catalogue doesn't know. */
  | "other-printer"
  /** On the user's own printer preset, not the slicer's for that printer. */
  | "custom-printer"
  /** Doesn't name its nozzle (`printer_variant`, `nozzle_diameter`), which the site reads its printer by and the
   *  slicer's command line needs to run at all. */
  | "no-nozzle"
  /** Objects whose solids overlap, which the slicer prints into each other. */
  | "overlapping-objects"
  /** Several filaments and no wipe tower position: the slicer's default is past the back of most beds. */
  | "no-tower-position"
  /** The wipe tower would print into an object or past the bed's edge. */
  | "tower-in-the-way"
  /** Objects past the bed's edge or height, or on an area of it nothing may print on. */
  | "off-bed";

export type ThreeMfFix =
  /** The project written as the slicer's, for the printer. */
  | "convert"
  /** The slicer named as the app that wrote it, and its settings by the slicer's names. */
  | "retag"
  /** The slicer's presets for the printer named, with the designer's changes kept on them. */
  | "retarget"
  /** The printer's nozzle named. */
  | "set-nozzle"
  /** One object, with a part for each, as the slicer keeps a multi-colour model. */
  | "merge-objects"
  /** The tower moved where it keeps clear of the plate's objects. */
  | "place-tower";

export type ThreeMfIssue = {
  check: ThreeMfCheckId;
  problem: ThreeMfProblem;
  /** 1-based, as the slicer numbers plates; null for the whole file. */
  plate: number | null;
  /** The objects it's about, by name. */
  objects?: string[];
  /** What the copy changes; null where Thingport can't, and the designer has to in the slicer. */
  fix: ThreeMfFix | null;
};

/** One of the catalogue's printers, with a nozzle it has ("0.4"). */
export type ThreeMfPrinter = { id: string; nozzle: string };

export type ThreeMfCheckResult = {
  /** The printer the copy is for, null while one has to be picked. */
  printer: ThreeMfPrinter | null;
  /** The file isn't for one of the brand's printers: the rest is checked once one is picked. */
  needsPrinter: boolean;
  issues: ThreeMfIssue[];
};

export type ThreeMfCheckOptions = {
  /** The printer to publish it for; absent, the file's own where it's one of the brand's. */
  printer?: ThreeMfPrinter | null;
};
