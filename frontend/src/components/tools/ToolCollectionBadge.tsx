import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTools } from "../../hooks/useTools";
import { reopenContextMenuBelow, TileMenuHeader } from "../Layout/ConfigurationDialog/AppTiles";
import ToolIcon from "./ToolIcon";

/** The tool a collection belongs to, from the user's tools; null while they load, or for one they can't open. */
function useToolOf(toolId: string) {
  return useTools()?.tools.find((tool) => tool.id === toolId) ?? null;
}

/** Where a tool's collection is opened from the Tools page: it opens the tool's window. */
export const toolOpenPath = (toolId: string) => `/tools?open=${encodeURIComponent(toolId)}`;

/** A padlock where a synced collection shows its provider: the collection belongs to a tool, which keeps it as it is. */
export function ToolCollectionBadge({ toolId, size = 30 }: { toolId: string; size?: number }) {
  const { t } = useTranslation("models");
  const tool = useToolOf(toolId);
  const label = tool ? t("collections.tool.badge", { tool: tool.manifest.name }) : t("collections.tool.badgeUnknown");
  return (
    <Tooltip title={label}>
      <Box
        sx={{
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          width: size,
          height: size,
          borderRadius: "8px",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          color: "text.secondary",
        }}
      >
        <LockOutlinedIcon titleAccess={label} sx={{ fontSize: Math.round(size * 0.55) }} />
      </Box>
    </Tooltip>
  );
}

type MenuProps = {
  toolId: string;
  /** The collection's name, for the menu's header. */
  name: string;
  at: { top: number; left: number } | null;
  onClose: () => void;
  onOpenCollection: () => void;
};

/** A tool's collection's right-click menu: whose it is, and opening it or the tool. */
export function ToolCollectionMenu({ toolId, name, at, onClose, onOpenCollection }: MenuProps) {
  const { t } = useTranslation("models");
  const navigate = useNavigate();
  const tool = useToolOf(toolId);
  return (
    <Menu
      open={Boolean(at)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={at ?? undefined}
      onContextMenu={(event) => reopenContextMenuBelow(event, onClose)}
    >
      <TileMenuHeader
        logo={
          <Box sx={{ display: "flex", color: "primary.main" }}>
            {tool ? <ToolIcon iconUrl={tool.manifest.iconUrl} size={28} /> : <LockOutlinedIcon />}
          </Box>
        }
        name={name}
        status={tool ? t("collections.tool.status", { tool: tool.manifest.name }) : t("collections.tool.badgeUnknown")}
      />
      <MenuItem
        onClick={() => {
          onClose();
          onOpenCollection();
        }}
      >
        <ListItemIcon>
          <CollectionsOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("collections.tool.openCollection")}</ListItemText>
      </MenuItem>
      <MenuItem
        disabled={!tool}
        onClick={() => {
          onClose();
          navigate(toolOpenPath(toolId));
        }}
      >
        <ListItemIcon>
          <LaunchIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          {tool ? t("collections.tool.openTool", { tool: tool.manifest.name }) : t("collections.tool.openToolUnknown")}
        </ListItemText>
      </MenuItem>
    </Menu>
  );
}
