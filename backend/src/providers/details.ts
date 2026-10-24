import { emptyImportedPageMetadata, type ImportedPageMetadata } from "../services/importResolvers";
import type { ResolvedModel } from "./types";

/** A model's details from what its provider resolved, with what it has nothing for left empty. */
export function detailsOf(resolved: Pick<ResolvedModel, "meta" | "galleryImages"> | null): ImportedPageMetadata | null {
  return resolved && { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
}
