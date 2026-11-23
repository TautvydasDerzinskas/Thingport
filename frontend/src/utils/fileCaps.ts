import type { FileCaps, Plate } from "../api/prints";
import { MODEL_EXTS } from "../constants/fileTypes";
import { extOf } from "./fileExtensions";

// What the app offers of a file comes with the file, worked out by the server. A payload from an older backend has
// none, and legacyCaps stands in with what the app offered before, from the name: frozen, and gone a release after the
// supporting-files series.

/** What the app offered of a file before the server said. Never extended. */
export function legacyCaps(filename: string, role: "plate" | "supporting" | "prepared"): FileCaps {
  const drawn = role === "plate" && MODEL_EXTS.has(extOf(filename));
  return {
    preview3d: drawn,
    // Every plate and the prepared print were offered to the slicer.
    openInSlicer: role !== "supporting",
    openInStudio: drawn,
    // Customize went by the model's generator_scripts, which still say.
    customize: false,
  };
}

/** What the app may offer of a plate. */
export function plateCaps(plate: Pick<Plate, "filename" | "caps">): FileCaps {
  return plate.caps ?? legacyCaps(plate.filename, "plate");
}
