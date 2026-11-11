import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import type { Plate } from "../../api/prints";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { fileRowText } from "./fileRowText";
import { shortNames } from "../../utils/fileFolders";
import type { MenuAnchor } from "./SlicerFileMenu";

// Which of a model's 3D files to open in Thingport Studio, when it has several: as the slicer's file picker asks.

type Props = {
  anchorEl: MenuAnchor;
  onClose: () => void;
  files: Plate[];
  onOpen: (plate: Plate) => void;
};

export default function StudioFileMenu({ anchorEl, onClose, files, onOpen }: Props) {
  const { t } = useTranslation(["models"]);
  const names = useMemo(
    () =>
      shortNames(
        files,
        (plate) => plate.id,
        (plate) => plate.filename,
        (plate) => plate.folder,
      ),
    [files],
  );
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      slotProps={{ paper: { sx: { maxWidth: 360 } } }}
    >
      <ListSubheader sx={{ lineHeight: "32px" }}>{t("models:detail.openInStudio")}</ListSubheader>
      {files.map((plate) => (
        <MenuItem
          key={plate.id}
          title={plate.filename}
          onClick={() => {
            onClose();
            onOpen(plate);
          }}
        >
          <ListItemIcon sx={{ minWidth: 44 }}>
            <PlateThumbnail plate={plate} />
          </ListItemIcon>
          <ListItemText
            {...fileRowText(t, plate.filename, plate.position, plate.folder, names.get(plate.id))}
            primaryTypographyProps={{ variant: "body2", noWrap: true }}
            secondaryTypographyProps={{ variant: "caption", noWrap: true }}
          />
        </MenuItem>
      ))}
    </Menu>
  );
}
