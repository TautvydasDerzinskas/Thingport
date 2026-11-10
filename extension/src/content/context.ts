import type { SourceGap } from "../shared/api";
import type { Classification } from "../shared/urls";

/** The model is in the library. "complete": everything the page has is in it, so the panel opens it in Thingport.
 *  "imported" (this profile too): the model has gaps to fill or lacks some of the page's other profiles. Otherwise
 *  this profile may be missing, so offer to add it. */
export type LibraryState = {
  state: "complete" | "imported" | "profile_missing" | "profile_unknown";
  printId: string | null;
  gaps: SourceGap[];
  /** The print profiles the model has a file of; null from an instance that doesn't say. */
  heldProfiles: string[] | null;
  /** "complete": how many print profiles the page has, as counted when that was found out; 0 where it couldn't be. */
  profiles?: number;
};

/** Set once per page by init(); title is filled in later. */
export type ImportContext = {
  url: string;
  instanceUrl: string;
  classification: Classification;
  library: LibraryState | null;
  /** "Add to the queue" is on offer: the import waits in the instance's import queue. */
  canQueue: boolean;
  /** That queue is the user's own, rather than one only an admin starts. Decides how the panel words it. */
  importQueue: boolean;
  title?: string | null;
};

let current: ImportContext | null = null;

export function setContext(context: ImportContext | null): void {
  current = context;
}

/** Throws once an SPA navigation has cleared it; flows that must survive capture what they need
 *  up front. */
export function ctx(): ImportContext {
  if (!current) throw new Error("The page changed while this was running");
  return current;
}
