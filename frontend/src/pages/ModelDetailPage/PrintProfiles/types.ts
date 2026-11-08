import type { ModelFile } from "../useOpenInSlicer";
import type { ProfileEntry } from "./entries";

/** What each of the side panel's ways of showing profiles takes. */
export type ProfileViewProps = {
  entries: ProfileEntry[];
  /** The model's files that aren't profiles: raw model files, the prepared print. */
  otherFiles: ModelFile[];
  /** The file Open and Download act on: a profile's plate id, or another file's key. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Opens the 3D preview on one of a profile's plates. */
  onPreviewPlate?: (key: string, plateIndex: number) => void;
};
