import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { alpha, keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListSubheader from "@mui/material/ListSubheader";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import { toolsApi, TOOL_CATEGORIES, type Tool, type ToolCategory } from "../../api/tools";
import type { ToolSort } from "../../api/settings";
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
import Segmented from "../../components/controls/Segmented";
import ToolAboutDialog from "../../components/tools/ToolAboutDialog";
import ToolEditorDialog from "../../components/tools/ToolEditorDialog";
import ToolIcon from "../../components/tools/ToolIcon";
import ToolWindow from "../../components/tools/ToolWindow";
import { useTools } from "../../hooks/useTools";
import { useToolsView } from "../../hooks/useToolsView";

const ICON = 60;
const COLUMN = 104;

/** The orders the page offers, as the models page's grid does. */
const SORTS: ToolSort[] = ["name", "newest", "author"];

/** Where a tool sits: where the user put it, else where its own metadata says, else with the rest. */
const shelfOf = (tool: Tool, moved: Record<string, string>): ToolCategory => {
  const chosen = moved[tool.id];
  if (chosen && (TOOL_CATEGORIES as readonly string[]).includes(chosen)) return chosen as ToolCategory;
  return tool.manifest.category ?? "other";
};

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
  const [view, setView] = useToolsView();
  const [dragging, setDragging] = useState<Tool | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  // ?open=<id>, from "Open <tool>" on a tool's collection: that tool's window, once the tools are in.
  const openId = searchParams.get("open");
  useEffect(() => {
    if (!openId || !state) return;
    const tool = state.tools.find((candidate) => candidate.id === openId);
    if (tool) setRunning(tool);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
  }, [openId, state, setSearchParams]);

  const canCreate = state?.access.canCreate ?? false;
  const sort = view?.sort ?? "newest";
  const layout = view?.layout ?? "categories";

  /** The tools in the order the user chose. Name is the one that doesn't move about under them. */
  const ordered = useMemo(() => {
    const tools = state?.tools ?? [];
    const byName = (a: Tool, b: Tool) => a.manifest.name.localeCompare(b.manifest.name);
    if (sort === "newest") return tools.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
    if (sort === "author")
      return tools.toSorted((a, b) => (a.manifest.author ?? "").localeCompare(b.manifest.author ?? "") || byName(a, b));
    return tools.toSorted(byName);
  }, [state, sort]);

  const installed = useMemo(() => ordered.filter((tool) => tool.source === "repo"), [ordered]);
  const mine = useMemo(() => ordered.filter((tool) => tool.source === "own"), [ordered]);

  /** The shelves, in the order the categories are listed. */
  const shelves = useMemo(() => {
    const moved = view?.categories ?? {};
    return TOOL_CATEGORIES.map((category) => ({
      category,
      tools: ordered.filter((tool) => shelfOf(tool, moved) === category),
    }));
  }, [ordered, view]);

  // An empty shelf is hidden, until a tool is in the air and wants somewhere to land.
  const shown = dragging ? shelves : shelves.filter((shelf) => shelf.tools.length > 0);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a double-click still opens the tool.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A press and hold on a touchscreen, so a tap opens the tool and a swipe scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const dropped = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const category = TOOL_CATEGORIES.find((candidate) => candidate === over?.id);
    const tool = ordered.find((candidate) => candidate.id === active.id);
    if (!category || !tool || shelfOf(tool, view?.categories ?? {}) === category) return;
    setView({ categories: { [tool.id]: category } });
  };

  usePageHeader({ title: t("tools.page.title"), subtitle: t("tools.page.subtitle") });

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

  /** Takes a repository tool off the whole instance, as Administration does: everyone's, not just the admin's. */
  const uninstall = async (tool: Tool) => {
    const ok = await confirm({
      title: t("tools.page.uninstallTitle", { name: tool.manifest.name }),
      message: t("tools.page.uninstallMessage", { name: tool.manifest.name }),
      confirmLabel: t("tools.page.uninstall"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await toolsApi.uninstall(tool.slug);
      await state?.reload();
      toast({ message: t("tools.page.uninstalled", { name: tool.manifest.name }), severity: "success" });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    }
  };

  const tiles = (tools: Tool[], offset: number, movable = false) => (
    <AppGrid column={COLUMN}>
      {tools.map((tool, index) => (
        <TileSlot key={tool.id} id={tool.id} movable={movable} delay={Math.min((offset + index) * 35, 350)}>
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
        </TileSlot>
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
          {/* `useFlexGap` spaces the row with `gap`: Stack's own spacing is a margin on the second child, which
              would beat the `auto` that holds the order at the right-hand end. */}
          <Stack direction="row" useFlexGap spacing={2} alignItems="center" flexWrap="wrap">
            <Segmented
              label={t("tools.page.layout")}
              value={layout}
              onChange={(next) => setView({ layout: next })}
              options={[
                { value: "flat", label: t("tools.page.layoutFlat") },
                { value: "categories", label: t("tools.page.layoutCategories") },
              ]}
            />
            {canCreate && (
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
                {t("tools.page.new")}
              </Button>
            )}
            <Box sx={{ ml: "auto" }}>
              <SortTools value={sort} onChange={(next) => setView({ sort: next })} />
            </Box>
          </Stack>

          {layout === "categories" ? (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={({ active }: DragStartEvent) =>
                setDragging(ordered.find((tool) => tool.id === active.id) ?? null)
              }
              onDragEnd={dropped}
              onDragCancel={() => setDragging(null)}
            >
              <Stack spacing={2}>
                {shown.map((shelf, index) => (
                  <Shelf
                    key={shelf.category}
                    category={shelf.category}
                    label={t(`tools.categories.${shelf.category}`)}
                    hint={t("tools.page.dropHere")}
                  >
                    {shelf.tools.length > 0 &&
                      tiles(
                        shelf.tools,
                        shown.slice(0, index).reduce((count, before) => count + before.tools.length, 0),
                        true,
                      )}
                  </Shelf>
                ))}
              </Stack>
            </DndContext>
          ) : (
            [
              installed.length > 0 && (
                <Stack key="installed" spacing={1}>
                  {mine.length > 0 && <GroupLabel>{t("tools.page.installed")}</GroupLabel>}
                  {tiles(installed, 0)}
                </Stack>
              ),
              mine.length > 0 && (
                <Stack key="mine" spacing={1}>
                  <GroupLabel>{t("tools.page.mine")}</GroupLabel>
                  {tiles(mine, installed.length)}
                </Stack>
              ),
            ]
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
          <Divider key="shelves-divider" />,
          <ListSubheader key="shelves-heading" sx={{ bgcolor: "transparent", lineHeight: "32px" }}>
            {t("tools.page.moveTo")}
          </ListSubheader>,
          ...TOOL_CATEGORIES.map((category) => {
            const here = shelfOf(menuTool, view?.categories ?? {}) === category;
            return (
              <MenuItem
                key={`shelf-${category}`}
                selected={here}
                onClick={() => {
                  closeMenu();
                  // Moving a tool is only visible on the shelves, so showing them comes with the move.
                  setView({ categories: { [menuTool.id]: category }, layout: "categories" });
                }}
              >
                <ListItemIcon>{here ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
                <ListItemText>{t(`tools.categories.${category}`)}</ListItemText>
              </MenuItem>
            );
          }),
          // Only where something follows it, so the menu never ends on a line.
          (menuTool.collectionId || (menuTool.source === "own" && canCreate)) && <Divider key="shelves-end" />,
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
          isAdmin &&
            menuTool.source === "repo" && [
              <Divider key="admin-divider" />,
              <MenuItem
                key="uninstall"
                onClick={() => {
                  closeMenu();
                  void uninstall(menuTool);
                }}
              >
                <ListItemIcon>
                  <DeleteOutlineIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText sx={{ color: "error.main" }}>{t("tools.page.uninstall")}</ListItemText>
              </MenuItem>,
            ],
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

/** The order the tools are in, as the models page's grid offers its own: plain words, the chosen one in the accent. */
function SortTools({ value, onChange }: { value: ToolSort; onChange: (sort: ToolSort) => void }) {
  const { t } = useTranslation("app");
  return (
    <Stack direction="row" spacing={3} component="fieldset" sx={{ border: 0, m: 0, p: 0 }}>
      {SORTS.map((mode) => (
        <Typography
          key={mode}
          component="button"
          type="button"
          variant="body2"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          sx={{
            border: 0,
            p: 0,
            bgcolor: "transparent",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: value === mode ? 700 : 500,
            color: value === mode ? "primary.main" : "text.secondary",
            "&:hover": { color: "primary.main" },
          }}
        >
          {t(`tools.page.sort.${mode}`)}
        </Typography>
      ))}
    </Stack>
  );
}

/** One icon's place in the grid: it settles in as the page opens, and on the shelves it can be picked up. */
function TileSlot({
  id,
  movable,
  delay,
  children,
}: {
  id: string;
  movable: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({ id, disabled: !movable });
  return (
    // Two boxes: the outer one follows the pointer, the inner one settles in. One element can't do both, since the
    // animation holds `transform` after it ends.
    <Box
      ref={setNodeRef}
      {...listeners}
      sx={{
        display: "grid",
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 2 : undefined,
        opacity: isDragging ? 0.85 : undefined,
        cursor: isDragging ? "grabbing" : undefined,
      }}
    >
      <Box
        sx={{
          display: "grid",
          animation: `${appear} 240ms ease-out both`,
          animationDelay: `${delay}ms`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/** A shelf and its heading, lit up while a tool is held over it. */
function Shelf({
  category,
  label,
  hint,
  children,
}: {
  category: ToolCategory;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: category });
  return (
    <Stack
      ref={setNodeRef}
      spacing={1}
      sx={{
        // The padding is taken back off at the sides, so the icons stay in line with the rest of the page.
        p: 1,
        mx: -1,
        borderRadius: "12px",
        border: 1,
        borderStyle: "dashed",
        borderColor: isOver ? "primary.main" : "transparent",
        bgcolor: isOver ? (theme) => alpha(theme.palette.primary.main, 0.06) : "transparent",
        transition: "border-color 160ms, background-color 160ms",
      }}
    >
      <GroupLabel>{label}</GroupLabel>
      {children || (
        <Typography variant="caption" color="text.secondary" sx={{ py: 1.5 }}>
          {hint}
        </Typography>
      )}
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
