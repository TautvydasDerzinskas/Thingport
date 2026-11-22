import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { studioApi, type StudioDesignSummary } from "../../api/studio";
import TileMenu, { type TileMenuSection } from "../../components/menus/TileMenu";
import type { MenuAction } from "../../components/menus/menuAction";
import { relativeTime } from "../../utils/relativeTime";
import { BoxIcon } from "./studioIcons";

const RECENT_COUNT = 3;

/** The designs edited last, newest first, leaving out the open one. */
export function recentDesigns(designs: StudioDesignSummary[], openId: string | null, count = RECENT_COUNT) {
  return designs
    .filter((design) => design.id !== openId)
    .toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, count);
}

type Props = {
  /** The open design's id, or null with none open. */
  designId: string | null;
  onNewDesign: () => void;
  /** Opens the dialog listing every design and the library. */
  onBrowseDesigns: () => void;
  onSwitchDesign: (id: string) => void;
  onRenameDesign: () => void;
  onExport: () => void;
  onOpenSlicer: () => void;
  onDeleteDesign: () => void;
};

export default function StudioDesignMenu({
  designId,
  onNewDesign,
  onBrowseDesigns,
  onSwitchDesign,
  onRenameDesign,
  onExport,
  onOpenSlicer,
  onDeleteDesign,
}: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const menuId = useId();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = anchorEl !== null;
  const label = t("common:moreActions");

  // Fetched ahead, so the menu opens at its full height, and again on each opening. Without them the menu still
  // works, so a failure only leaves them out.
  const [designs, setDesigns] = useState<StudioDesignSummary[]>([]);
  const refreshDesigns = () => void studioApi.list().then(setDesigns, () => {});
  useEffect(() => {
    let cancelled = false;
    studioApi.list().then(
      (list) => !cancelled && setDesigns(list),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const action = (
    key: string,
    text: string,
    icon: ReactNode,
    onSelect: () => void,
    extra?: Partial<MenuAction>,
  ): MenuAction => ({ key, label: text, icon, onSelect, ...extra });
  const hasDesign = designId !== null;
  const tiles = [
    action("new", t("studio.design.menu.new"), <AddBoxOutlinedIcon />, onNewDesign),
    action("open", t("studio.design.menu.open"), <FolderOpenOutlinedIcon />, onBrowseDesigns),
    ...(hasDesign
      ? [
          action("export", t("studio.design.export.title"), <FileDownloadOutlinedIcon />, onExport),
          action("slicer", t("studio.design.menu.slicer"), <LaunchIcon />, onOpenSlicer),
        ]
      : []),
  ];
  const sections: TileMenuSection[] = [
    {
      key: "recent",
      heading: t("studio.design.menu.recent"),
      items: recentDesigns(designs, designId).map((design) =>
        action(`design-${design.id}`, design.name, <BoxIcon />, () => onSwitchDesign(design.id), {
          secondary: t("studio.design.menu.edited", { time: relativeTime(design.updated_at, i18n.language) }),
        }),
      ),
    },
  ];
  if (hasDesign) {
    sections.push({
      key: "design",
      divider: true,
      items: [
        action("rename", t("studio.design.rename"), <DriveFileRenameOutlineOutlinedIcon />, onRenameDesign),
        action("delete", t("studio.design.delete"), <DeleteOutlineIcon />, onDeleteDesign, { tone: "error" }),
      ],
    });
  }

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open || undefined}
          aria-controls={open ? menuId : undefined}
          onClick={(event) => {
            setAnchorEl(event.currentTarget);
            refreshDesigns();
          }}
          sx={{ flexShrink: 0 }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <TileMenu
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        id={menuId}
        label={label}
        tilesLabel={t("studio.design.menu.quickActions")}
        tiles={tiles}
        sections={sections}
      />
    </>
  );
}
