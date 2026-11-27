import { useNavigate } from "react-router-dom";
import type { Plate, Print } from "../../api/prints";
import { useStudioEnabled } from "../../hooks/useStudioEnabled";
import type { StudioArrival } from "../StudioPage/openModel";
import { plateCaps } from "../../utils/fileCaps";

// Opening a model's 3D file in Thingport Studio as a new design, when the backend has Studio: from the model's page,
// and from its menu wherever the model is a tile.

export function useOpenInStudio(print: Print) {
  const navigate = useNavigate();
  const studioEnabled = useStudioEnabled() === true;
  /** The model's files Studio can open, in the model's order; none on a backend without Studio. */
  const files = studioEnabled ? print.plates.filter((plate) => plateCaps(plate).openInStudio) : [];

  const open = (plate?: Plate) =>
    navigate("/studio", {
      state: {
        openModel: {
          model: { id: print.id, title: print.title || print.name },
          ...(plate ? { fileId: plate.id, filename: plate.filename } : { allFiles: true }),
        },
      } satisfies StudioArrival,
    });

  return { files, open, openAll: () => open() };
}
