import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import { toolsApi, type Tool } from "../../api/tools";
import { UnauthorizedError } from "../../api/client";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import {
  AppGrid,
  AppTile,
  menuPosition,
  reopenContextMenuBelow,
  TileMenuHeader,
} from "../../components/Layout/ConfigurationDialog/AppTiles";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import ToolAboutDialog from "../../components/tools/ToolAboutDialog";
import ToolEditorDialog from "../../components/tools/ToolEditorDialog";
import ToolIcon from "../../components/tools/ToolIcon";
import ToolWindow from "../../components/tools/ToolWindow";
import { useTools } from "../../hooks/useTools";

const ICON = 60;
const COLUMN = 104;

// Each icon settles into place as the page opens, one after another.
const appear = keyframes`from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; }`;

type Props = {
  isAdmin: boolean;
  onUnauthorized?: () => void;
};

/** The user's tools as icons: double-click one to open it in a window, right-click for what else it offers. */
export default function ToolsPage({ isAdmin, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const state = useTools();
  const [running, setRunning] = useState<Tool | null>(null);
  const [about, setAbout] = useState<Tool | null>(null);
  const [menu, setMenu] = useState<{ tool: Tool; at: { top: number; left: number } } | null>(null);
  const [editing, setEditing] = useState<Tool | "new" | null>(null);

  const canCreate = state?.access.canCreate ?? false;
  const installed = useMemo(() => state?.tools.filter((tool) => tool.source === "repo") ?? [], [state]);
  const mine = useMemo(() => state?.tools.filter((tool) => tool.source === "own") ?? [], [state]);

  usePageHeader({
    title: t("tools.page.title"),
    subtitle: t("tools.page.subtitle"),
    actions: canCreate ? (
      <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
        {t("tools.page.new")}
      </Button>
    ) : undefined,
  });

  const remove = async (tool: Tool) => {
    const ok = await confirm({
      title: t("tools.page.deleteTitle"),
      message: t("tools.page.deleteMessage", { name: tool.manifest.name }),
      confirmLabel: t("tools.page.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await toolsApi.remove(tool.id);
      await state?.reload();
      toast({ message: t("tools.page.deleted", { name: tool.manifest.name }), severity: "success" });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    }
  };

  const tiles = (tools: Tool[], offset: number) => (
    <AppGrid column={COLUMN}>
      {tools.map((tool, index) => (
        <Box
          key={tool.id}
          sx={{
            display: "grid",
            animation: `${appear} 240ms ease-out both`,
            animationDelay: `${Math.min((offset + index) * 35, 350)}ms`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          <AppTile
            name={tool.manifest.name}
            subtitle={tool.source === "own" ? t("tools.page.yours") : undefined}
            logo={
              <Box sx={{ display: "flex", color: "primary.main" }}>
                <ToolIcon iconUrl={tool.manifest.iconUrl} size={Math.round(ICON * 0.6)} />
              </Box>
            }
            size={ICON}
            tileBg="background.paper"
            on
            highlighted={menu?.tool.id === tool.id}
            tooltip={tool.manifest.description || undefined}
            ariaLabel={t("tools.page.tileLabel", { name: tool.manifest.name })}
            onActivate={() => setRunning(tool)}
            // A tap opens it at once: there's no double-tap on a phone.
            onClick={(event) => {
              if ((event.nativeEvent as PointerEvent).pointerType === "touch") setRunning(tool);
            }}
            onContextMenu={(event) => setMenu({ tool, at: menuPosition(event) })}
          />
        </Box>
      ))}
    </AppGrid>
  );

  const closeMenu = () => setMenu(null);
  const menuTool = menu?.tool;

  return (
    <Stack spacing={3}>
      {state === null ? (
        <AppGrid column={COLUMN}>
          {Array.from({ length: 6 }, (_, index) => (
            <Stack key={index} alignItems="center" spacing={0.75} sx={{ py: 1 }} aria-hidden>
              <Skeleton variant="rounded" width={ICON} height={ICON} sx={{ borderRadius: "16px" }} />
              <Skeleton variant="text" width={64} />
            </Stack>
          ))}
        </AppGrid>
      ) : !state.access.canUse ? (
        <EmptyState text={t("tools.page.noAccess")} />
      ) : !state.tools.length ? (
        <EmptyState
          text={canCreate ? t("tools.page.emptyCreate") : isAdmin ? t("tools.page.emptyAdmin") : t("tools.page.empty")}
          action={
            canCreate ? (
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
                {t("tools.page.new")}
              </Button>
            ) : isAdmin ? (
              <Button variant="outlined" onClick={() => navigate("/admin-tools")}>
                {t("tools.page.install")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {installed.length > 0 && (
            <Stack spacing={1}>
              {mine.length > 0 && <GroupLabel>{t("tools.page.installed")}</GroupLabel>}
              {tiles(installed, 0)}
            </Stack>
          )}
          {mine.length > 0 && (
            <Stack spacing={1}>
              <GroupLabel>{t("tools.page.mine")}</GroupLabel>
              {tiles(mine, installed.length)}
            </Stack>
          )}
        </>
      )}

      <Menu
        open={Boolean(menu)}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={menu?.at}
        onContextMenu={(event) => reopenContextMenuBelow(event, closeMenu)}
      >
        {menuTool && [
          <TileMenuHeader
            key="header"
            logo={
              <Box sx={{ display: "flex", color: "primary.main" }}>
                <ToolIcon iconUrl={menuTool.manifest.iconUrl} size={28} />
              </Box>
            }
            name={menuTool.manifest.name}
            status={
              menuTool.source === "own"
                ? t("tools.page.yours")
                : t("tools.about.version", { version: menuTool.manifest.version })
            }
          />,
          <MenuItem
            key="open"
            onClick={() => {
              closeMenu();
              setRunning(menuTool);
            }}
          >
            <ListItemIcon>
              <LaunchIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("tools.page.open")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="about"
            onClick={() => {
              closeMenu();
              setAbout(menuTool);
            }}
          >
            <ListItemIcon>
              <InfoOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("tools.page.about")}</ListItemText>
          </MenuItem>,
          menuTool.collectionId && (
            <MenuItem
              key="models"
              onClick={() => {
                closeMenu();
                navigate(`/models/collections/${menuTool.collectionId}`);
              }}
            >
              <ListItemIcon>
                <CollectionsOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("tools.page.models")}</ListItemText>
            </MenuItem>
          ),
          menuTool.source === "own" &&
            canCreate && [
              <MenuItem
                key="edit"
                onClick={() => {
                  closeMenu();
                  setEditing(menuTool);
                }}
              >
                <ListItemIcon>
                  <EditOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("tools.page.edit")}</ListItemText>
              </MenuItem>,
              <Divider key="divider" />,
              <MenuItem
                key="delete"
                onClick={() => {
                  closeMenu();
                  void remove(menuTool);
                }}
              >
                <ListItemIcon>
                  <DeleteOutlineIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText sx={{ color: "error.main" }}>{t("tools.page.delete")}</ListItemText>
              </MenuItem>,
            ],
        ]}
      </Menu>

      <ToolWindow
        tool={running}
        onClose={() => setRunning(null)}
        onAbout={running ? () => setAbout(running) : undefined}
      />
      <ToolAboutDialog
        tool={about}
        onClose={() => setAbout(null)}
        onOpen={
          running
            ? undefined
            : (tool) => {
                setAbout(null);
                setRunning(tool);
              }
        }
      />
      <ToolEditorDialog
        open={editing !== null}
        tool={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async (saved) => {
          setEditing(null);
          await state?.reload();
          toast({ message: t("tools.editor.saved", { name: saved.manifest.name }), severity: "success" });
        }}
        onUnauthorized={onUnauthorized}
      />
    </Stack>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      component="h2"
      sx={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "text.secondary" }}
    >
      {children}
    </Typography>
  );
}

function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 8, color: "text.secondary", textAlign: "center" }}>
      <HandymanOutlinedIcon sx={{ fontSize: 40, opacity: 0.6 }} />
      <Typography variant="body2" sx={{ maxWidth: 360 }}>
        {text}
      </Typography>
      {action}
    </Stack>
  );
}
