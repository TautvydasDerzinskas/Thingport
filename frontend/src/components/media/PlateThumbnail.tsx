import Box from "@mui/material/Box";
import { type Plate, printsApi } from "../../api/prints";
import { extOf } from "../../utils/fileExtensions";
import { ModelSnapshot } from "./ModelViewer/ModelSnapshot";
import { plateCaps } from "../../utils/fileCaps";

type Props = {
  plate: Plate;
  size?: number;
};

/** The stored thumbnail, else a snapshot rendered on the spot (and saved), else a placeholder. */
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
  if (plateCaps(plate).preview3d) {
    return (
      <Box sx={boxSx}>
        <ModelSnapshot url={printsApi.fileUrl(plate.url)} ext={ext} plateId={plate.id} theme="light" compact />
      </Box>
    );
  }
  return <Box sx={{ ...boxSx, bgcolor: "action.hover" }} />;
}
