import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PrintIcon from "@mui/icons-material/Print";
import PlateThumbnail from "../../../components/media/PlateThumbnail";
import { formatFileSize } from "../../../utils/fileSize";
import { extOf, stemOf } from "../../../utils/fileExtensions";
import { folderLabel } from "../../../utils/fileFolders";
import { PREPARED_KEY, type ModelFile } from "../useOpenInSlicer";

/** A file of a model with print profiles that isn't one of them: a raw model file, or the prepared print. A file in a
 *  folder says which, as two of one name may be in two. */
export function useOtherFileText() {
  const { t } = useTranslation("models");
  return (file: ModelFile): { primary: string; secondary: string } => {
    if (file.key === PREPARED_KEY && !file.plate) {
      return { primary: t("detail.preparedPrintFile"), secondary: file.filename };
    }
    const type = extOf(file.filename).toUpperCase();
    const size = file.plate?.size ?? file.size;
    return {
      primary: stemOf(file.filename),
      secondary: [
        file.folder ? folderLabel(file.folder) : null,
        type || null,
        typeof size === "number" ? formatFileSize(size) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  };
}

export function OtherFileIcon({ file, size = 40 }: { file: ModelFile; size?: number }) {
  if (file.plate) return <PlateThumbnail plate={file.plate} size={size} />;
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "text.secondary",
      }}
    >
      {file.key === PREPARED_KEY ? <PrintIcon fontSize="small" /> : <InsertDriveFileOutlinedIcon fontSize="small" />}
    </Box>
  );
}
