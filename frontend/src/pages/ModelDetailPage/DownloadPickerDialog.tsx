import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import DownloadIcon from "@mui/icons-material/Download";
import type { Plate } from "../../api/prints";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { fileRowText } from "./fileRowText";

type Props = {
  open: boolean;
  onClose: () => void;
  downloading: boolean;
  sortedPlates: Plate[];
  downloadAllZip: () => void;
  downloadPlate: (plate: Plate) => void;
};

/** The "which file?" picker shown when a multi-file model's download is triggered -- see
 *  useDownloadPrint. Shared by ModelActionsMenu's "Download" menu item and the detail page's
 *  "Download model files" button. */
export default function DownloadPickerDialog({ open, onClose, downloading, sortedPlates, downloadAllZip, downloadPlate }: Props) {
  const { t } = useTranslation(["models", "common"]);
  return (
    <Dialog open={open} onClose={() => !downloading && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{t("models:detail.downloadPickerTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Button
            variant="contained"
            onClick={downloadAllZip}
            disabled={downloading}
            startIcon={downloading ? <CircularProgress size={14} /> : <DownloadIcon fontSize="small" />}
          >
            {t("models:detail.downloadAllZip", { count: sortedPlates.length })}
          </Button>
          <Divider>{t("models:detail.orDownloadOne")}</Divider>
          <List disablePadding>
            {sortedPlates.map((plate, idx) => (
              <ListItemButton
                key={plate.id}
                onClick={() => downloadPlate(plate)}
                disabled={downloading}
                title={plate.filename}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 60 }}>
                  <PlateThumbnail plate={plate} size={48} />
                </ListItemIcon>
                <ListItemText
                  {...fileRowText(t, plate.filename, idx)}
                  primaryTypographyProps={{ noWrap: true }}
                  secondaryTypographyProps={{ noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={downloading}>{t("common:cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
