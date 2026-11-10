import type { ImportStatus, SourceGap } from "../shared/api";
import type { Classification } from "../shared/urls";
import type { MissingProfiles } from "./profiles";

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

/** Where the model stands in the library, by the instance's answer and what the model lacks of the page's print
 *  profiles (profileGap); null for one it hasn't got. "complete" once nothing's left to bring over. Profiles it can't
 *  tell the model has are offered as the page's own, as with the instance's "profile_unknown": the model may lack
 *  them, so it isn't called complete. A model the instance doesn't name has nothing to fill in, so it's complete. */
export function libraryStateOf(status: ImportStatus, gap: MissingProfiles | "none" | null): LibraryState | null {
  const printId = status.print_id ?? null;
  const gaps = status.gaps ?? [];
  const heldProfiles = status.imported_profile_ids ?? null;
  if (!status.already_imported) {
    return status.state === "profile_missing" || status.state === "profile_unknown"
      ? { state: status.state, printId, gaps, heldProfiles }
      : null;
  }
  const missing = gap === "none" ? null : gap;
  if (!printId) return { state: "complete", printId, gaps: [], heldProfiles, profiles: 0 };
  if (gaps.length || missing?.all.length) return { state: "imported", printId, gaps, heldProfiles };
  if (gap === null) return { state: "profile_unknown", printId, gaps, heldProfiles };
  return { state: "complete", printId, gaps: [], heldProfiles, profiles: missing?.total ?? 0 };
}

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
