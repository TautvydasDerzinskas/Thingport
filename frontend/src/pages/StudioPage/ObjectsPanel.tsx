import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  type ClientRect,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
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
import CreateNewFolderOutlinedIcon from "@mui/icons-material/CreateNewFolderOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
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
  DEFAULT_PROFILE_ID,
  MAX_PLATES,
  MAX_PROFILES,
  featureById,
  inputsOf,
  isBody,
  plateOf,
  profileOf,
  studioPlates,
  studioProfiles,
  topLevel,
  type Feature,
  type StudioDocument,
  type StudioPlate,
} from "../../studio/document";
import { FeatureIcon, IntersectIcon, SubtractIcon, UnionIcon } from "./studioIcons";
import { featureLabel, plateLabel, profileLabel } from "./labels";
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
  onEditProfile: (id: string, plateId?: string) => void;
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

type BranchKind = "profiles" | "plates";

const branchKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, collisionRect, droppableContainers, droppableRects, over } = args.context;
  if (active?.data.current?.kind !== "profiles") return sortableKeyboardCoordinates(event, args);
  if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
  event.preventDefault();
  const current = droppableRects.get(over?.id ?? active.id) ?? collisionRect;
  if (!current) return;
  const direction = event.code === "ArrowDown" ? 1 : -1;
  let target: ClientRect | undefined;
  let distance = Infinity;
  for (const entry of droppableContainers.getEnabled()) {
    if (entry.data.current?.kind !== "profiles") continue;
    const rect = droppableRects.get(entry.id);
    if (!rect) continue;
    const step = direction * (rect.top - current.top);
    if (step > 0 && step < distance) {
      distance = step;
      target = rect;
    }
  }
  if (target) return { x: target.left, y: target.top };
};

function branchCollisions(args: Parameters<CollisionDetection>[0], tree: HTMLDivElement | null) {
  const kind = args.active.data.current?.kind;
  const candidates = args.droppableContainers.filter((entry) =>
    kind === "profiles" ? entry.data.current?.kind === "profiles" : true,
  );
  const rows = { ...args, droppableContainers: candidates };
  if (!args.pointerCoordinates) return closestCenter(rows);
  const { x, y } = args.pointerCoordinates;
  const bounds = tree?.getBoundingClientRect();
  if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return [];
  const hits = pointerWithin(rows);
  if (hits.length) return hits;

  // The insertion line sits at the edge of the whole branch, including its expanded children.
  const branchRects: typeof args.droppableRects = new Map();
  for (const entry of candidates) {
    if (entry.data.current?.kind !== kind) continue;
    const rect = entry.data.current?.branchRef?.current?.getBoundingClientRect();
    if (!rect) continue;
    const { top, bottom, left, right, width, height } = rect;
    branchRects.set(entry.id, { top: top - 1, bottom: bottom + 1, left, right, width, height: height + 2 });
  }
  return pointerWithin({ ...rows, droppableRects: branchRects });
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

type BranchItemProps = {
  id: string;
  kind: BranchKind;
  hidden?: true;
  dropInto?: boolean;
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

function BranchItem({
  id,
  kind,
  hidden,
  dropInto,
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
}: BranchItemProps) {
  const { t } = useTranslation(["app", "common"]);
  const branchRef = useRef<HTMLDivElement>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id,
    data: { kind, branchRef },
    disabled: !canEdit,
  });
  const BranchIcon = kind === "profiles" ? FolderOutlinedIcon : LayersOutlinedIcon;
  const expandLabel = `${t(expanded ? "studio.tree.collapse" : "studio.tree.expand")} ${name}`;
  return (
    <Box
      ref={branchRef}
      role="treeitem"
      aria-label={name}
      aria-expanded={expanded}
      aria-current={active}
      // The overlay shows the plate being dragged; its place stays as a faint placeholder. Plates sit apart, as bands.
      sx={{ position: "relative", opacity: isDragging ? 0.4 : 1, "& + &": { mt: 0.75 } }}
    >
      {dropLine && <DropLine at={dropLine} />}
      <ListItemButton
        ref={setNodeRef}
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
          bgcolor: alpha(theme.palette.text.primary, kind === "profiles" ? 0.08 : 0.05),
          boxShadow: dropInto
            ? `inset 0 0 0 2px ${theme.palette.primary.main}`
            : active
              ? `inset 3px 0 0 ${theme.palette.primary.main}`
              : "none",
          "&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.09) },
          "&.Mui-selected": { bgcolor: alpha(theme.palette.primary.main, 0.12) },
          "&.Mui-selected:hover": { bgcolor: alpha(theme.palette.primary.main, 0.18) },
          "& .row-action": { opacity: 0, transition: "opacity 150ms" },
          "&:hover .row-action, &:focus-within .row-action": { opacity: 1 },
        })}
      >
        {canEdit && (
          <Tooltip title={t(`studio.${kind}.drag`)}>
            <Box
              ref={setActivatorNodeRef}
              component="span"
              className="row-action"
              {...attributes}
              {...listeners}
              aria-label={`${t(`studio.${kind}.drag`)}: ${name}`}
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
        <Tooltip title={expandLabel}>
          <IconButton
            size="small"
            aria-label={expandLabel}
            onClick={(event) => {
              event.stopPropagation();
              onExpand(!expanded);
            }}
            sx={{ p: 0, color: "text.secondary" }}
          >
            <ChevronRightIcon sx={{ fontSize: 18, transform: expanded ? "rotate(90deg)" : "none" }} />
          </IconButton>
        </Tooltip>
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
          <BranchIcon sx={{ fontSize: 15 }} />
        </Box>
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 650, opacity: hidden ? 0.5 : 1 }}>
          {name}
        </Typography>
        {kind === "plates" && count > 0 && (
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
          <Tooltip title={t(`studio.${kind}.${hidden ? "show" : "hide"}`)}>
            <IconButton
              className="row-action"
              size="small"
              aria-label={`${t(`studio.${kind}.${hidden ? "show" : "hide"}`)}: ${name}`}
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
          <Tooltip title={t(`studio.${kind}.actions`)}>
            <IconButton
              size="small"
              aria-haspopup="menu"
              aria-label={`${t(`studio.${kind}.actions`)}: ${name}`}
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
  onEditProfile,
  onArrange,
  onExportPlate,
  onSelect,
  onMenu,
  onHide,
  run,
}: Props) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const title = t("studio.profiles.title");
  const treeRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: branchKeyboardCoordinates }),
  );
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [branchExpansion, setBranchExpansion] = useState<Partial<Record<string, boolean>>>({});
  const [plateMenu, setPlateMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [plateDialog, setPlateDialog] = useState<{ kind: "create" | "rename"; id: string } | null>(null);
  const [profileDialog, setProfileDialog] = useState<{ id?: string } | null>(null);
  const [profileMenu, setProfileMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [emptySelection, setEmptySelection] = useState<{ profileId: string; activePlate: string } | null>(null);
  const plates = document ? studioPlates(document) : [];
  const profiles = document ? studioProfiles(document) : [];
  const platesOf = (id: string) => plates.filter((plate) => profileOf(plate) === id);
  const activeProfile = profileOf(plates.find((plate) => plate.id === activePlate));
  const emptyProfile =
    emptySelection?.activePlate === activePlate &&
    profiles.some((profile) => profile.id === emptySelection.profileId) &&
    !platesOf(emptySelection.profileId).length
      ? emptySelection.profileId
      : null;
  if (emptySelection && !emptyProfile) setEmptySelection(null);
  const selectedProfile = emptyProfile ?? activeProfile;
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

  const menuProfile = profiles.find((profile) => profile.id === profileMenu?.id);
  const renameProfile = profiles.find((profile) => profile.id === profileDialog?.id);
  const profileIndex = menuProfile ? profiles.indexOf(menuProfile) : -1;
  const siblingPlates = menuPlate ? platesOf(profileOf(menuPlate)) : [];
  const menuIndex = menuPlate ? siblingPlates.indexOf(menuPlate) : -1;
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
  const movePlate = (id: string, position: number, profileId?: string) => {
    void run("move_plate", { plate_id: id, position, profile_id: profileId });
    if (profileId) expandBranch(profileId, true);
  };
  const moveProfile = (id: string, position: number) => void run("move_profile", { profile_id: id, position });
  const dropLineOf = (id: string): "before" | "after" | null => {
    if (!drag || drag.over !== id || drag.over === drag.id) return null;
    const toProfile = profiles.find((profile) => profile.id === id);
    if (toProfile) {
      const from = profiles.findIndex((profile) => profile.id === drag.id);
      return from < 0 ? null : from < profiles.indexOf(toProfile) ? "after" : "before";
    }
    const toPlate = plates.find((plate) => plate.id === id);
    const fromPlate = plates.find((plate) => plate.id === drag.id);
    if (!toPlate || !fromPlate) return null;
    return profileOf(fromPlate) === profileOf(toPlate) && plates.indexOf(fromPlate) < plates.indexOf(toPlate)
      ? "after"
      : "before";
  };
  const dropBranch = ({ active, over }: DragEndEvent) => {
    setDrag(null);
    if (!over || active.id === over.id) return;
    const sourceProfile = profiles.find((profile) => profile.id === active.id);
    const targetProfile = profiles.find((profile) => profile.id === over.id);
    if (sourceProfile) {
      if (targetProfile) moveProfile(sourceProfile.id, profiles.indexOf(targetProfile) + 1);
      return;
    }
    const source = plates.find((plate) => plate.id === active.id);
    if (!source) return;
    if (targetProfile) {
      const position = platesOf(targetProfile.id).filter((plate) => plate.id !== source.id).length + 1;
      movePlate(source.id, position, targetProfile.id);
      return;
    }
    const target = plates.find((plate) => plate.id === over.id);
    if (target) movePlate(source.id, platesOf(profileOf(target)).indexOf(target) + 1, profileOf(target));
  };
  const draggedPlate = plates.find((plate) => plate.id === drag?.id);
  const draggedProfile = profiles.find((profile) => profile.id === drag?.id);

  const expandBranch = (id: string, expanded: boolean) => {
    setBranchExpansion((prev) => ({ ...prev, [id]: expanded }));
  };
  const activatePlate = (id: string, profileId: string) => {
    setEmptySelection(null);
    expandBranch(profileId, true);
    expandBranch(id, true);
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
            if (editing) {
              setEmptySelection(null);
              onSelect(plateId, feature.id, event.shiftKey || event.metaKey || event.ctrlKey);
            } else if (children.length) toggle(feature.id);
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
          <>
            <Tooltip title={t("studio.plates.add")}>
              <span>
                <IconButton
                  size="small"
                  disabled={plates.length >= MAX_PLATES}
                  aria-label={t("studio.plates.add")}
                  onClick={() => setPlateDialog({ kind: "create", id: selectedProfile })}
                  sx={{ p: 0.25 }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t("studio.profiles.add")}>
              <span>
                <IconButton
                  size="small"
                  disabled={profiles.length >= MAX_PROFILES}
                  aria-label={t("studio.profiles.add")}
                  onClick={() => setProfileDialog({})}
                  sx={{ p: 0.25 }}
                >
                  <CreateNewFolderOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )
      }
    >
      <Box
        ref={treeRef}
        role="tree"
        aria-label={title}
        aria-multiselectable={editing || undefined}
        sx={{ height: "100%", overflow: "auto", px: 0.75, pb: 1 }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={(args) => branchCollisions(args, treeRef.current)}
          onDragStart={({ active }) => setDrag({ id: String(active.id), over: null })}
          onDragOver={({ active, over }) => setDrag({ id: String(active.id), over: over ? String(over.id) : null })}
          onDragEnd={dropBranch}
          onDragCancel={() => setDrag(null)}
        >
          <SortableContext
            items={profiles.flatMap((profile) => [profile.id, ...platesOf(profile.id).map((plate) => plate.id)])}
            strategy={verticalListSortingStrategy}
          >
            {profiles.map((profile) => {
              const children = platesOf(profile.id);
              const active = profile.id === activeProfile;
              return (
                <BranchItem
                  key={profile.id}
                  id={profile.id}
                  kind="profiles"
                  name={profileLabel(profile, t)}
                  hidden={profile.hidden}
                  active={profile.id === selectedProfile}
                  expanded={branchExpansion[profile.id] ?? (active || !children.length)}
                  canEdit={canEditPlates}
                  hasActions={canEditPlates}
                  dropLine={dropLineOf(profile.id)}
                  dropInto={Boolean(draggedPlate && drag?.over === profile.id)}
                  count={children.length}
                  onActivate={() => {
                    expandBranch(profile.id, true);
                    if (!children.length) setEmptySelection({ profileId: profile.id, activePlate });
                    else if (active) setEmptySelection(null);
                    else {
                      const first = children.find((plate) => !plate.hidden) ?? children[0];
                      activatePlate(first.id, profile.id);
                    }
                  }}
                  onExpand={(next) => expandBranch(profile.id, next)}
                  onMenu={(anchor) => setProfileMenu({ id: profile.id, anchor })}
                  onToggleHidden={() =>
                    void run("set_profile_visibility", { profile_id: profile.id, visible: Boolean(profile.hidden) })
                  }
                >
                  {children.map((plate) => {
                    const plateActive = plate.id === activePlate;
                    const roots = rootsByPlate.get(plate.id) ?? [];
                    return (
                      <BranchItem
                        key={plate.id}
                        id={plate.id}
                        kind="plates"
                        name={plateLabel(plate, t)}
                        hidden={plate.hidden}
                        active={plateActive}
                        expanded={branchExpansion[plate.id] ?? plateActive}
                        canEdit={canEditPlates}
                        hasActions={canEditPlates || (!profile.hidden && canExportPlate(plate))}
                        dropLine={dropLineOf(plate.id)}
                        count={roots.length}
                        onActivate={() => activatePlate(plate.id, profile.id)}
                        onExpand={(next) => expandBranch(plate.id, next)}
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
                      </BranchItem>
                    );
                  })}
                  {!children.length &&
                    (canEditPlates && plates.length < MAX_PLATES ? (
                      <ListItemButton
                        dense
                        onClick={() => setPlateDialog({ kind: "create", id: profile.id })}
                        sx={{ gap: 0.5, borderRadius: 1, color: "text.secondary", px: 0.5 }}
                      >
                        <AddIcon sx={{ fontSize: 16 }} />
                        <ListItemText primary={t("studio.plates.add")} />
                      </ListItemButton>
                    ) : (
                      <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                        {t("studio.profiles.empty")}
                      </Typography>
                    ))}
                </BranchItem>
              );
            })}
          </SortableContext>
          <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
            {(draggedPlate || draggedProfile) && (
              <Paper
                elevation={6}
                sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.5, minHeight: 32, cursor: "grabbing" }}
              >
                <DragIndicatorIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                {draggedProfile ? (
                  <FolderOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                ) : (
                  <LayersOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                )}
                <Typography variant="body2" noWrap sx={{ fontWeight: 500, pr: 1 }}>
                  {draggedProfile ? profileLabel(draggedProfile, t) : plateLabel(draggedPlate!, t)}
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
          disabled={
            exporting ||
            !menuPlate ||
            !canExportPlate(menuPlate) ||
            profiles.some((profile) => profile.id === profileOf(menuPlate) && profile.hidden)
          }
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
            disabled={menuIndex < 0 || menuIndex >= siblingPlates.length - 1}
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
          ...profiles
            .filter((profile) => profile.id !== profileOf(menuPlate))
            .map((profile) => (
              <MenuItem
                key={profile.id}
                onClick={() => {
                  if (menuPlate) movePlate(menuPlate.id, platesOf(profile.id).length + 1, profile.id);
                  setPlateMenu(null);
                }}
              >
                <ListItemIcon>
                  <FolderOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("studio.profiles.movePlateTo", { name: profileLabel(profile, t) })}</ListItemText>
              </MenuItem>
            )),
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
      {canEditPlates && menuProfile && (
        <Menu
          anchorEl={profileMenu?.anchor}
          open
          onClose={() => setProfileMenu(null)}
          onContextMenu={(event) => reopenContextMenuBelow(event, () => setProfileMenu(null))}
        >
          <MenuItem
            disabled={plates.length >= MAX_PLATES}
            onClick={() => {
              setPlateDialog({ kind: "create", id: menuProfile.id });
              setProfileMenu(null);
            }}
          >
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.add")}</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              const children = platesOf(menuProfile.id);
              const plate =
                children.find((entry) => entry.id === activePlate) ??
                children.find((entry) => !entry.hidden) ??
                children[0];
              if (plate) expandBranch(menuProfile.id, true);
              onEditProfile(menuProfile.id, plate?.id);
              setProfileMenu(null);
            }}
          >
            <ListItemIcon>
              <TuneOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.profiles.settings")}</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setProfileDialog({ id: menuProfile.id });
              setProfileMenu(null);
            }}
          >
            <ListItemIcon>
              <DriveFileRenameOutlineOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.profiles.rename")}</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem
            disabled={profileIndex < 1}
            onClick={() => {
              moveProfile(menuProfile.id, profileIndex);
              setProfileMenu(null);
            }}
          >
            <ListItemIcon>
              <ArrowUpwardIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.moveUp")}</ListItemText>
          </MenuItem>
          <MenuItem
            disabled={profileIndex >= profiles.length - 1}
            onClick={() => {
              moveProfile(menuProfile.id, profileIndex + 2);
              setProfileMenu(null);
            }}
          >
            <ListItemIcon>
              <ArrowDownwardIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.plates.moveDown")}</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              void run("set_profile_visibility", { profile_id: menuProfile.id, visible: Boolean(menuProfile.hidden) });
              setProfileMenu(null);
            }}
          >
            <ListItemIcon>
              {menuProfile.hidden ? (
                <VisibilityOffOutlinedIcon fontSize="small" />
              ) : (
                <VisibilityOutlinedIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>{t(menuProfile.hidden ? "studio.profiles.show" : "studio.profiles.hide")}</ListItemText>
          </MenuItem>
          {menuProfile.id !== DEFAULT_PROFILE_ID && [
            <Divider key="delete-divider" />,
            <MenuItem
              key="delete"
              disabled={platesOf(menuProfile.id).length > 0}
              onClick={() => {
                void run("delete_profile", { profile_id: menuProfile.id });
                setProfileMenu(null);
              }}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "inherit" }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("studio.profiles.delete")}</ListItemText>
            </MenuItem>,
          ]}
        </Menu>
      )}
      {canEditPlates && (
        <RenameDialog
          value={
            renameProfile
              ? profileLabel(renameProfile, t)
              : profileDialog
                ? t("studio.profiles.defaultName", { number: document?.next_profile_id ?? 2 })
                : null
          }
          title={t(renameProfile ? "studio.profiles.rename" : "studio.profiles.add")}
          maxLength={80}
          onClose={() => setProfileDialog(null)}
          onSave={(name) => {
            if (profileDialog?.id) void run("rename_profile", { profile_id: profileDialog.id, name });
            else
              void run("create_profile", { name }).then((created) => {
                if (created?.[0]) expandBranch(created[0], true);
              });
          }}
        />
      )}
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
              void run("create_plate", { name, profile_id: plateDialog.id }).then((created) => {
                if (created?.[0]) activatePlate(created[0], plateDialog.id);
              });
          }}
        />
      )}
    </SidePanel>
  );
}
