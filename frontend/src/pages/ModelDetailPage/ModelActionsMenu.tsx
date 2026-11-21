import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import LaunchIcon from "@mui/icons-material/Launch";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Print } from "../../api/prints";
import type { AuthUser } from "../../api/auth";
import NestedMenu from "../../components/menus/NestedMenu";
import TileMenu from "../../components/menus/TileMenu";
import type { MenuAnchor } from "../../components/menus/menuAction";
import { reopenContextMenuBelow } from "../../components/Layout/ConfigurationDialog/AppTiles";
import { submenuTree, tileLayout } from "./modelMenuLayout";
import { useModelActions } from "./useModelActions";

type Props = {
  print: Print;
  /** Tiles for the model page's header, where there's room; submenus for a card's short menu. */
  layout?: "tiles" | "submenus";
  onUnauthorized?: () => void;
  onDeleted: () => void;
  onUpdated?: (print: Print) => void;
  /** Only for a real collection; shows "Remove from collection". */
  collectionId?: string;
  onRemovedFromCollection?: () => void;
  onCollectionCountChange?: (count: number) => void;
  triggerSx?: SxProps<Theme>;
  /** Glyph size in px; defaults to fontSize="small". */
  iconFontSize?: number;
  viewer?: AuthUser | null;
  /** Opens the menu at this point instead of at the trigger, as on a right-click. */
  contextMenuAt?: { top: number; left: number } | null;
  onContextMenuClose?: () => void;
  /** Offers linking a model with no source to its page on a provider. */
  offerLink?: boolean;
};

/** The "..." menu for a model, shared by the detail header and grid cards. */
export default function ModelActionsMenu({
  print,
  layout = "submenus",
  triggerSx,
  iconFontSize,
  contextMenuAt,
  onContextMenuClose,
  ...options
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const menuId = useId();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  // A point rather than anchorPosition, so both menus can take either.
  const menuAnchor: MenuAnchor =
    anchorEl ??
    (contextMenuAt
      ? { nodeType: 1, getBoundingClientRect: () => new DOMRect(contextMenuAt.left, contextMenuAt.top, 0, 0) }
      : null);
  const open = menuAnchor !== null;

  const closeMenu = useCallback(() => {
    setAnchorEl(null);
    onContextMenuClose?.();
  }, [onContextMenuClose]);

  const { actions, dialogs, working } = useModelActions({ print, closeMenu, ...options });
  const labels = { open: t("models:actionsMenu.openIn"), ai: t("models:actionsMenu.ai") };
  const menuProps = {
    open,
    anchorEl: menuAnchor,
    atPoint: !anchorEl && Boolean(contextMenuAt),
    onClose: closeMenu,
    id: menuId,
    label: t("common:moreActions"),
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => reopenContextMenuBelow(event, closeMenu),
  };

  return (
    <>
      <Tooltip title={t("common:moreActions")}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label={t("common:moreActions") ?? undefined}
            aria-haspopup="menu"
            aria-expanded={open || undefined}
            aria-controls={open ? menuId : undefined}
            disabled={working}
            sx={triggerSx}
          >
            {working ? (
              <CircularProgress size={18} />
            ) : iconFontSize ? (
              <MoreVertIcon sx={{ fontSize: iconFontSize }} />
            ) : (
              <MoreVertIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
      {layout === "tiles" ? (
        <TileMenu {...menuProps} tilesLabel={t("models:actionsMenu.quickActions")} {...tileLayout(actions, labels)} />
      ) : (
        <NestedMenu
          {...menuProps}
          nodes={submenuTree(actions, labels, { open: <LaunchIcon />, ai: <AutoAwesomeIcon /> })}
        />
      )}
      {dialogs}
    </>
  );
}
