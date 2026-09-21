import Box from "@mui/material/Box";
import { type Plate, printsApi } from "../../api/prints";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { extOf } from "../../utils/fileExtensions";
import { ModelSnapshot } from "./ModelViewer/ModelSnapshot";

type Props = {
  plate: Plate;
  /** Square edge in px. */
  size?: number;
};

/** A small square preview of one plate for plate lists (3D preview switcher, download picker):
 *  its stored thumbnail when it has one; otherwise, for a 3D file (STL/OBJ/STEP carry no
 *  embedded thumbnail, and only a model's first plate gets one from its grid card), a snapshot
 *  rendered on the spot -- which ModelSnapshot also saves server-side, so it's there next time;
 *  otherwise a plain placeholder. */
export default function PlateThumbnail({ plate, size = 32 }: Props) {
  const boxSx = { width: size, height: size, flexShrink: 0, borderRadius: 0.75, overflow: "hidden" };
  const ext = extOf(plate.filename);

  if (plate.thumb_url) {
    return (
      <Box
        component="img"
        src={printsApi.fileUrl(plate.thumb_url)}
        alt={plate.filename}
        sx={{ ...boxSx, objectFit: "cover" }}
      />
    );
  }
  if (MODEL_EXTS.has(ext)) {
    return (
      <Box sx={boxSx}>
        <ModelSnapshot url={printsApi.fileUrl(plate.url)} ext={ext} plateId={plate.id} theme="light" compact />
      </Box>
    );
  }
  return <Box sx={{ ...boxSx, bgcolor: "action.hover" }} />;
}
