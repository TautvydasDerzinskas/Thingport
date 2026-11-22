import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";

type Props = {
  hasDesign: boolean;
  onNewDesign: () => void;
  onOpenDesign: () => void;
  onRenameDesign: () => void;
  onExport: () => void;
  onOpenSlicer: () => void;
  onDeleteDesign: () => void;
};

export default function StudioDesignMenu({
  hasDesign,
  onNewDesign,
  onOpenDesign,
  onRenameDesign,
  onExport,
  onOpenSlicer,
  onDeleteDesign,
}: Props) {
  const { t } = useTranslation(["app", "common"]);
  const menuId = useId();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const label = t("common:moreActions");
  const select = (action: () => void) => () => {
    setAnchorEl(null);
    action();
  };

  const items = [
    { key: "studio.design.new", Icon: AddBoxOutlinedIcon, action: onNewDesign },
    { key: "studio.design.open", Icon: FolderOpenOutlinedIcon, action: onOpenDesign },
  ];
  if (hasDesign) {
    items.push(
      { key: "studio.design.rename", Icon: DriveFileRenameOutlineOutlinedIcon, action: onRenameDesign },
      { key: "studio.design.export.title", Icon: FileDownloadOutlinedIcon, action: onExport },
      { key: "studio.plates.openSlicer", Icon: VideocamOutlinedIcon, action: onOpenSlicer },
    );
  }

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchorEl)}
          aria-controls={anchorEl ? menuId : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ flexShrink: 0 }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{ list: { id: menuId, "aria-label": label } }}
      >
        {items.map(({ key, Icon, action }) => (
          <MenuItem key={key} onClick={select(action)}>
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t(key)}</ListItemText>
          </MenuItem>
        ))}
        {hasDesign && <Divider />}
        {hasDesign && (
          <MenuItem onClick={select(onDeleteDesign)} sx={{ color: "error.main" }}>
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.design.delete")}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
