import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  DEFAULT_PLATE_ID,
  MAX_PLATES,
  featureById,
  inputsOf,
  isBody,
  plateOf,
  studioPlates,
  topLevel,
  type Feature,
  type StudioDocument,
  type StudioPlate,
} from "../../studio/document";
import { FeatureIcon, IntersectIcon, SubtractIcon, UnionIcon } from "./studioIcons";
import { featureLabel, plateLabel } from "./labels";
import RenameDialog from "../../components/RenameDialog";
import { useConfirm } from "../../components/ConfirmProvider";
import SidePanel from "./SidePanel";
import type { RunCommand } from "./useStudioDesign";
import { reopenContextMenuBelow } from "../../components/Layout/ConfigurationDialog/AppTiles";
import type { MenuAnchor } from "../../components/menus/menuAction";

/** Where a right-click happened, or the row itself for one from the keyboard, which has no point. */
function contextAnchor(event: React.MouseEvent<HTMLElement>): MenuAnchor {
  const { clientX, clientY } = event;
  if (!clientX && !clientY) return event.currentTarget;
  return { nodeType: 1, getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0) };
}

type Props = {
  document: StudioDocument | null;
  activePlate: string;
  editing: boolean;
  exporting: boolean;
  selected: readonly string[];
  errors: Record<string, string>;
  onChangePlate: (id: string) => void;
  onArrange: (id: string) => void;
  onExportPlate: (id: string) => void;
  onSelect: (plateId: string, featureId: string, additive: boolean) => void;
  onMenu: (plateId: string, featureId: string, at: { top: number; left: number }) => void;
  onHide: () => void;
  run: RunCommand;
};

function Icon({ feature }: { feature: Feature }) {
  const sx = { fontSize: 18 };
  if (feature.type === "boolean") {
    if (feature.operation === "subtract") return <SubtractIcon sx={sx} />;
    if (feature.operation === "intersect") return <IntersectIcon sx={sx} />;
    return <UnionIcon sx={sx} />;
  }
  return <FeatureIcon type={feature.type} sx={sx} />;
}

/** Where the plate being dragged would land, drawn as a line across the tree. */
function DropLine({ at }: { at: "before" | "after" }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        left: 6,
        right: 6,
        height: 2,
        bgcolor: "primary.main",
        borderRadius: 1,
        zIndex: 1,
        pointerEvents: "none",
        ...(at === "before" ? { top: -1 } : { bottom: -1 }),
        "&::before": {
          content: '""',
          position: "absolute",
          left: -4,
          top: -3,
          width: 8,
          height: 8,
          borderRadius: "50%",
          border: 2,
          borderColor: "primary.main",
          bgcolor: "background.paper",
          boxSizing: "border-box",
        },
      }}
    />
  );
}

type PlateItemProps = {
  plate: StudioPlate;
  name: string;
  active: boolean;
  expanded: boolean;
  canEdit: boolean;
  hasActions: boolean;
  dropLine: "before" | "after" | null;
  /** How many objects are on it, shown beside its name. */
  count: number;
  onActivate: () => void;
  onExpand: (expanded: boolean) => void;
  onMenu: (anchor: MenuAnchor) => void;
  onToggleHidden: () => void;
  children: ReactNode;
};

/** A plate and what's on it. In edit mode its grip drags it to another place in the list. */
function PlateItem({
  plate,
  name,
  active,
  expanded,
  canEdit,
  hasActions,
  dropLine,
  count,
  onActivate,
  onExpand,
  onMenu,
  onToggleHidden,
  children,
}: PlateItemProps) {
  const { t } = useTranslation(["app", "common"]);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id: plate.id,
    disabled: !canEdit,
  });
  const hidden = Boolean(plate.hidden);
  return (
    <Box
      ref={setNodeRef}
      role="treeitem"
      aria-label={name}
      aria-expanded={expanded}
      aria-current={active}
      // The overlay shows the plate being dragged; its place stays as a faint placeholder. Plates sit apart, as bands.
      sx={{ position: "relative", opacity: isDragging ? 0.4 : 1, "& + &": { mt: 0.75 } }}
    >
      {dropLine && <DropLine at={dropLine} />}
      <ListItemButton
        dense
        selected={active}
        aria-label={name}
        onClick={onActivate}
        onContextMenu={
          hasActions
            ? (event) => {
                event.preventDefault();
                onMenu(contextAnchor(event));
              }
            : undefined
        }
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          onExpand(event.key === "ArrowRight");
        }}
        // A plate is a shaded band, unlike an object's plain row; the one in view is tinted, with a bar at its edge.
        sx={(theme) => ({
          borderRadius: 1,
          px: 0.5,
          py: 0.25,
          gap: 0.5,
          minHeight: 34,
          bgcolor: alpha(theme.palette.text.primary, 0.05),
          boxShadow: active ? `inset 3px 0 0 ${theme.palette.primary.main}` : "none",
          "&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.09) },
          "&.Mui-selected": { bgcolor: alpha(theme.palette.primary.main, 0.12) },
          "&.Mui-selected:hover": { bgcolor: alpha(theme.palette.primary.main, 0.18) },
          "& .row-action": { opacity: 0, transition: "opacity 150ms" },
          "&:hover .row-action, &:focus-within .row-action": { opacity: 1 },
        })}
      >
        {canEdit && (
          <Tooltip title={t("studio.plates.drag")}>
            <Box
              ref={setActivatorNodeRef}
              component="span"
              className="row-action"
              {...attributes}
              {...listeners}
              aria-label={`${t("studio.plates.drag")}: ${name}`}
              onClick={(event) => event.stopPropagation()}
              sx={{
                display: "inline-flex",
                width: 14,
                ml: -0.25,
                flexShrink: 0,
                color: "text.secondary",
                cursor: isDragging ? "grabbing" : "grab",
                touchAction: "none",
                borderRadius: 0.5,
                "&:focus-visible": { opacity: 1, outline: 2, outlineColor: "primary.main", outlineStyle: "solid" },
              }}
            >
              <DragIndicatorIcon sx={{ fontSize: 16 }} />
            </Box>
          </Tooltip>
        )}
        <IconButton
          size="small"
          aria-label={`${t(expanded ? "studio.tree.collapse" : "studio.tree.expand")} ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onExpand(!expanded);
          }}
          sx={{ p: 0, color: "text.secondary" }}
        >
          <ChevronRightIcon sx={{ fontSize: 18, transform: expanded ? "rotate(90deg)" : "none" }} />
        </IconButton>
        <Box
          sx={{
            width: 22,
            height: 22,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            borderRadius: 1,
            bgcolor: "background.paper",
            color: active ? "primary.main" : "text.secondary",
            opacity: hidden ? 0.5 : 1,
          }}
        >
          <LayersOutlinedIcon sx={{ fontSize: 15 }} />
        </Box>
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 650, opacity: hidden ? 0.5 : 1 }}>
          {name}
        </Typography>
        {count > 0 && (
          <Typography
            variant="caption"
            aria-label={t("studio.plates.objects", { count })}
            sx={{
              flexShrink: 0,
              px: 0.75,
              lineHeight: "17px",
              borderRadius: 2,
              bgcolor: "background.paper",
              color: "text.secondary",
            }}
          >
            {count}
          </Typography>
        )}
        {canEdit && (
          <Tooltip title={t(hidden ? "studio.plates.show" : "studio.plates.hide")}>
            <IconButton
              className="row-action"
              size="small"
              aria-label={`${t(hidden ? "studio.plates.show" : "studio.plates.hide")}: ${name}`}
              aria-pressed={hidden}
              onClick={(event) => {
                event.stopPropagation();
                onToggleHidden();
              }}
              // A hidden plate keeps its crossed-out eye showing.
              sx={{ p: 0.25, ...(hidden ? { opacity: "1 !important" } : {}) }}
            >
              {hidden ? (
                <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} />
              ) : (
                <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </Tooltip>
        )}
        {hasActions && (
          <Tooltip title={t("studio.plates.actions")}>
            <IconButton
              size="small"
              aria-haspopup="menu"
              aria-label={`${t("studio.plates.actions")}: ${name}`}
              onClick={(event) => {
                event.stopPropagation();
                onMenu(event.currentTarget);
              }}
              sx={{ p: 0.25 }}
            >
              <MoreVertIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </ListItemButton>
      {expanded && (
        // Its objects hang on a guide line, at the same place in and out of edit mode, so they don't shift.
        <Box
          // A tree item's children are a group, which no HTML element is.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="group"
          sx={{
            opacity: hidden ? 0.5 : 1,
            ml: "13px",
            pl: 0.5,
            my: 0.25,
            borderLeft: 1,
            borderColor: "divider",
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}

export default function ObjectsPanel({
  document,
  activePlate,
  editing,
  exporting,
  selected,
  errors,
  onChangePlate,
  onArrange,
  onExportPlate,
  onSelect,
  onMenu,
  onHide,
  run,
}: Props) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const title = t("studio.panels.features");
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [plateExpansion, setPlateExpansion] = useState<Partial<Record<string, boolean>>>({});
  const [plateMenu, setPlateMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [plateDialog, setPlateDialog] = useState<{ kind: "create" } | { kind: "rename"; id: string } | null>(null);
  const plates = document ? studioPlates(document) : [];
  const rootsByPlate = new Map<string, Feature[]>();
  if (document) {
    for (const feature of topLevel(document)) {
      const id = plateOf(feature);
      const roots = rootsByPlate.get(id);
      if (roots) roots.push(feature);
      else rootsByPlate.set(id, [feature]);
    }
  }
  const menuPlate = plates.find((plate) => plate.id === plateMenu?.id);
  const renamePlate = plateDialog?.kind === "rename" ? plates.find((plate) => plate.id === plateDialog.id) : undefined;
  const canEditPlates = Boolean(document && editing);
  const canExportPlate = (plate: StudioPlate) =>
    Boolean(plate.source || rootsByPlate.get(plate.id)?.some((feature) => isBody(feature) && feature.visible));

  const menuIndex = menuPlate ? plates.indexOf(menuPlate) : -1;
  // Asks first, saying what goes with the plate; undo brings it all back.
  const deletePlate = async (plate: StudioPlate) => {
    const count = rootsByPlate.get(plate.id)?.length ?? 0;
    const ok = await confirm({
      title: t("studio.plates.deleteTitle", { name: plateLabel(plate, t) }),
      message: count
        ? t("studio.plates.deleteWith", { count })
        : plate.source
          ? t("studio.plates.deletePending")
          : t("studio.actions.deleteHint"),
      confirmLabel: t("studio.actions.delete"),
      destructive: true,
    });
    if (ok) void run("delete_plate", { plate_id: plate.id });
  };
  const movePlate = (id: string, position: number) => void run("move_plate", { plate_id: id, position });
  const dropLineOf = (id: string): "before" | "after" | null => {
    if (!drag || drag.over !== id || drag.over === drag.id) return null;
    const from = plates.findIndex((plate) => plate.id === drag.id);
    return from < plates.findIndex((plate) => plate.id === id) ? "after" : "before";
  };
  const dropPlate = ({ active, over }: DragEndEvent) => {
    setDrag(null);
    if (!over || active.id === over.id) return;
    const to = plates.findIndex((plate) => plate.id === over.id);
    if (to >= 0) movePlate(String(active.id), to + 1);
  };
  const draggedPlate = drag && plates.find((plate) => plate.id === drag.id);

  const expandPlate = (id: string, expanded: boolean) => {
    setPlateExpansion((prev) => ({ ...prev, [id]: expanded }));
  };
  const activatePlate = (id: string) => {
    expandPlate(id, true);
    onChangePlate(id);
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (feature: Feature, plateId: string, depth: number): React.ReactNode => {
    if (!document) return null;
    const children = inputsOf(feature)
      .map((id) => featureById(document, id))
      .filter((child): child is Feature => Boolean(child));
    const expanded = open.has(feature.id);
    const chosen = editing && selected.includes(feature.id);
    const label = featureLabel(feature, t);
    const menuAt = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      return { top: rect.bottom, left: rect.left };
    };
    return (
      <Box
        key={feature.id}
        role="treeitem"
        aria-expanded={children.length ? expanded : undefined}
        aria-selected={editing ? chosen : undefined}
      >
        <ListItemButton
          dense
          selected={chosen}
          tabIndex={editing || children.length ? 0 : -1}
          onClick={(event) => {
            if (editing) onSelect(plateId, feature.id, event.shiftKey || event.metaKey || event.ctrlKey);
            else if (children.length) toggle(feature.id);
          }}
          onContextMenu={
            editing
              ? (event) => {
                  event.preventDefault();
                  onMenu(plateId, feature.id, { top: event.clientY, left: event.clientX });
                }
              : undefined
          }
          // Right opens what it's built from, left folds it, as in a file tree.
          onKeyDown={(event) => {
            if (!children.length) return;
            if ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded)) {
              event.preventDefault();
              toggle(feature.id);
            }
          }}
          sx={{
            borderRadius: 1,
            pl: 0.5,
            pr: 0.25,
            py: 0.25,
            gap: 0.5,
            minHeight: 30,
            cursor: editing || children.length ? "pointer" : "default",
            opacity: feature.visible || depth > 0 ? 1 : 0.5,
            "& .row-action": { opacity: chosen ? 1 : 0, transition: "opacity 150ms" },
            "&:hover .row-action, &:focus-within .row-action": { opacity: 1 },
          }}
        >
          {children.length > 0 ? (
            <IconButton
              size="small"
              aria-label={t(expanded ? "studio.tree.collapse" : "studio.tree.expand")}
              onClick={(event) => {
                event.stopPropagation();
                toggle(feature.id);
              }}
              sx={{ p: 0, color: "text.secondary" }}
            >
              <ChevronRightIcon
                sx={{
                  fontSize: 18,
                  transform: expanded ? "rotate(90deg)" : "none",
                  transition: "transform 150ms",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
            </IconButton>
          ) : (
            <Box sx={{ width: 18, flexShrink: 0 }} />
          )}
          <Box sx={{ display: "inline-flex", color: chosen ? "primary.main" : "text.secondary", flexShrink: 0 }}>
            <Icon feature={feature} />
          </Box>
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontSize: "0.8125rem" }}>
            {label}
          </Typography>
          {errors[feature.id] && (
            <Tooltip title={errors[feature.id]}>
              <WarningAmberRoundedIcon
                aria-label={errors[feature.id]}
                sx={{ fontSize: 16, color: "warning.main", flexShrink: 0 }}
              />
            </Tooltip>
          )}
          {editing && depth === 0 && (
            <Tooltip title={feature.visible ? t("studio.actions.hide") : t("studio.actions.show")}>
              <IconButton
                className="row-action"
                size="small"
                aria-label={`${feature.visible ? t("studio.actions.hide") : t("studio.actions.show")}: ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void run("set_visibility", { feature_id: feature.id, visible: !feature.visible });
                }}
                sx={{ p: 0.25, ...(feature.visible ? {} : { opacity: "1 !important" }) }}
              >
                {feature.visible ? (
                  <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
                ) : (
                  <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            </Tooltip>
          )}
          {editing && (
            <Tooltip title={t("common:moreActions")}>
              <IconButton
                className="row-action"
                size="small"
                aria-label={`${t("common:moreActions")}: ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onMenu(plateId, feature.id, menuAt(event.currentTarget));
                }}
                sx={{ p: 0.25 }}
              >
                <MoreVertIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </ListItemButton>
        {expanded && (
          // A tree item's children are a group, which no HTML element is.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          <Box role="group" sx={{ ml: "13px", pl: 0.5, borderLeft: 1, borderColor: "divider" }}>
            {children.map((child) => row(child, plateId, depth + 1))}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <SidePanel
      title={title}
      side="left"
      hideLabel={t("studio.panels.hide", { panel: title })}
      onHide={onHide}
      actions={
        canEditPlates && (
          <Tooltip title={t("studio.plates.add")}>
            <span>
              <IconButton
                size="small"
                disabled={plates.length >= MAX_PLATES}
                aria-label={t("studio.plates.add")}
                onClick={() => setPlateDialog({ kind: "create" })}
                sx={{ p: 0.25 }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )
      }
    >
      <Box
        role="tree"
        aria-label={title}
        aria-multiselectable={editing || undefined}
        sx={{ height: "100%", overflow: "auto", px: 0.75, pb: 1 }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => setDrag({ id: String(active.id), over: null })}
          onDragOver={({ active, over }) => setDrag({ id: String(active.id), over: over ? String(over.id) : null })}
          onDragEnd={dropPlate}
          onDragCancel={() => setDrag(null)}
        >
          <SortableContext items={plates.map((plate) => plate.id)} strategy={verticalListSortingStrategy}>
            {plates.map((plate) => {
              const active = plate.id === activePlate;
              const expanded = plateExpansion[plate.id] ?? active;
              const roots = rootsByPlate.get(plate.id) ?? [];
              return (
                <PlateItem
                  key={plate.id}
                  plate={plate}
                  name={plateLabel(plate, t)}
                  active={active}
                  expanded={expanded}
                  canEdit={canEditPlates}
                  hasActions={canEditPlates || canExportPlate(plate)}
                  dropLine={dropLineOf(plate.id)}
                  count={roots.length}
                  onActivate={() => activatePlate(plate.id)}
                  onExpand={(next) => expandPlate(plate.id, next)}
                  onMenu={(anchor) => setPlateMenu({ id: plate.id, anchor })}
                  onToggleHidden={() =>
                    void run("set_plate_visibility", { plate_id: plate.id, visible: Boolean(plate.hidden) })
                  }
                >
                  {roots.length ? (
                    roots.map((feature) => row(feature, plate.id, 0))
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ pl: 1, pr: 1, py: 0.75, fontSize: "0.8125rem" }}
                    >
                      {t(plate.source ? "studio.importModel.platePending" : "studio.tree.empty")}
                    </Typography>
                  )}
                </PlateItem>
              );
            })}
          </SortableContext>
          <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
            {draggedPlate && (
              <Paper
                elevation={6}
                sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.5, minHeight: 32, cursor: "grabbing" }}
              >
                <DragIndicatorIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <LayersOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                <Typography variant="body2" noWrap sx={{ fontWeight: 500, pr: 1 }}>
                  {plateLabel(draggedPlate, t)}
                </Typography>
              </Paper>
            )}
          </DragOverlay>
        </DndContext>
      </Box>
      <Menu
        anchorEl={plateMenu?.anchor}
        open={Boolean(menuPlate)}
        onClose={() => setPlateMenu(null)}
        onContextMenu={(event) => reopenContextMenuBelow(event, () => setPlateMenu(null))}
      >
        <MenuItem
          disabled={exporting || !menuPlate || !canExportPlate(menuPlate)}
          onClick={() => {
            setPlateMenu(null);
            if (menuPlate) onExportPlate(menuPlate.id);
          }}
        >
          <ListItemIcon>
            <FileDownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("studio.plates.exportStl")}</ListItemText>
        </MenuItem>
        {canEditPlates && [
          <MenuItem
            key="arrange"
            disabled={
              !menuPlate ||
              Boolean(menuPlate.source) ||
              !rootsByPlate.get(menuPlate.id)?.some((feature) => isBody(feature) && feature.visible)
            }
            onClick={() => {
              if (menuPlate) onArrange(menuPlate.id);
              setPlateMenu(null);
            }}
          >
            <ListItemIcon>
              <GridViewOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.print.arrange")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="rename"
            onClick={() => {
              if (menuPlate) setPlateDialog({ kind: "rename", id: menuPlate.id });
              setPlateMenu(null);
            }}
          >
            <ListItemIcon>
              <DriveFileRenameOutlineOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.rename")}</ListItemText>
          </MenuItem>,
          <Divider key="order" />,
          <MenuItem
            key="up"
            disabled={menuIndex < 1}
            onClick={() => {
              if (menuPlate) movePlate(menuPlate.id, menuIndex);
              setPlateMenu(null);
            }}
          >
            <ListItemIcon>
              <ArrowUpwardIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.moveUp")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="down"
            disabled={menuIndex < 0 || menuIndex >= plates.length - 1}
            onClick={() => {
              if (menuPlate) movePlate(menuPlate.id, menuIndex + 2);
              setPlateMenu(null);
            }}
          >
            <ListItemIcon>
              <ArrowDownwardIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.moveDown")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="visibility"
            onClick={() => {
              if (menuPlate)
                void run("set_plate_visibility", { plate_id: menuPlate.id, visible: Boolean(menuPlate.hidden) });
              setPlateMenu(null);
            }}
          >
            <ListItemIcon>
              {menuPlate?.hidden ? (
                <VisibilityOutlinedIcon fontSize="small" />
              ) : (
                <VisibilityOffOutlinedIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>{t(menuPlate?.hidden ? "studio.plates.show" : "studio.plates.hide")}</ListItemText>
          </MenuItem>,
          <Divider key="delete-divider" />,
          <MenuItem
            key="delete"
            disabled={!menuPlate || menuPlate.id === DEFAULT_PLATE_ID}
            onClick={() => {
              setPlateMenu(null);
              if (menuPlate) void deletePlate(menuPlate);
            }}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.delete")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>
      {canEditPlates && (
        <RenameDialog
          value={
            plateDialog?.kind === "create"
              ? t("studio.plates.defaultName", { count: document?.next_plate_id ?? plates.length + 1 })
              : renamePlate
                ? plateLabel(renamePlate, t)
                : null
          }
          title={t(plateDialog?.kind === "create" ? "studio.plates.add" : "studio.plates.rename")}
          maxLength={80}
          onClose={() => setPlateDialog(null)}
          onSave={(name) => {
            if (renamePlate) void run("rename_plate", { plate_id: renamePlate.id, name });
            if (plateDialog?.kind === "create")
              void run("create_plate", { name }).then((created) => {
                if (created?.[0]) activatePlate(created[0]);
              });
          }}
        />
      )}
    </SidePanel>
  );
}
