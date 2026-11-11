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
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo } from "react";
import type { Plate } from "../../api/prints";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { fileRowText } from "./fileRowText";
import { extOf } from "../../utils/fileExtensions";
import { formatFileSize } from "../../utils/fileSize";
import { folderLabel, groupByFolder, hasFolders, shortNames } from "../../utils/fileFolders";

type Props = {
  open: boolean;
  onClose: () => void;
  downloading: boolean;
  sortedPlates: Plate[];
  downloadAllZip: () => void;
  /** One folder of the model's (Plate.folder), with the folders in it, as a zip. */
  downloadFolderZip: (folder: string) => void;
  downloadPlate: (plate: Plate) => void;
};

const folderOf = (plate: Plate) => plate.folder;

export default function DownloadPickerDialog({
  open,
  onClose,
  downloading,
  sortedPlates,
  downloadAllZip,
  downloadFolderZip,
  downloadPlate,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const grouped = hasFolders(sortedPlates, folderOf);
  const names = useMemo(
    () =>
      shortNames(
        sortedPlates,
        (plate) => plate.id,
        (plate) => plate.filename,
        folderOf,
      ),
    [sortedPlates],
  );
  const row = (plate: Plate, idx: number) => (
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
        {...(plate.folder
          ? {
              primary: names.get(plate.id) ?? plate.filename,
              secondary: [extOf(plate.filename).toUpperCase() || null, formatFileSize(plate.size)]
                .filter(Boolean)
                .join(" · "),
            }
          : fileRowText(t, plate.filename, idx))}
        primaryTypographyProps={{ noWrap: true }}
        secondaryTypographyProps={{ noWrap: true }}
      />
    </ListItemButton>
  );
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
            {grouped
              ? groupByFolder(sortedPlates, folderOf).map((group) => (
                  <li key={group.folder ?? ""}>
                    {group.folder && (
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={0.75}
                        sx={{ pl: 1, pr: 0.5, pt: 1, color: "text.secondary" }}
                      >
                        <FolderOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
                        <Typography variant="caption" fontWeight={700} noWrap sx={{ flex: 1, minWidth: 0 }}>
                          {folderLabel(group.folder)} · {group.items.length}
                        </Typography>
                        <Tooltip title={t("models:detail.downloadFolderZip", { folder: folderLabel(group.folder) })}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={downloading}
                              onClick={() => downloadFolderZip(group.folder!)}
                              aria-label={t("models:detail.downloadFolderZip", { folder: folderLabel(group.folder) })}
                            >
                              <FolderZipOutlinedIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                    <List disablePadding>{group.items.map((plate) => row(plate, sortedPlates.indexOf(plate)))}</List>
                  </li>
                ))
              : sortedPlates.map(row)}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={downloading}>
          {t("common:cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
