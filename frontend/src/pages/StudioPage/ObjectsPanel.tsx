import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
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
} from "../../studio/document";
import { FeatureIcon, IntersectIcon, SubtractIcon, UnionIcon } from "./studioIcons";
import { featureLabel } from "./labels";
import RenameDialog from "../../components/RenameDialog";
import SidePanel from "./SidePanel";
import type { RunCommand } from "./useStudioDesign";

type Props = {
  document: StudioDocument | null;
  activePlate: string;
  editing: boolean;
  selected: readonly string[];
  errors: Record<string, string>;
  onChangePlate: (id: string) => void;
  onArrange: (id: string) => void;
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

export default function ObjectsPanel({
  document,
  activePlate,
  editing,
  selected,
  errors,
  onChangePlate,
  onArrange,
  onSelect,
  onMenu,
  onHide,
  run,
}: Props) {
  const { t } = useTranslation("app");
  const title = t("studio.panels.features");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [plateExpansion, setPlateExpansion] = useState<Partial<Record<string, boolean>>>({});
  const [plateMenu, setPlateMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
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
            pl: 2 + depth * 1.5,
            pr: 0.25,
            py: 0.25,
            gap: 0.5,
            minHeight: 32,
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
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
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
          <Box role="group">{children.map((child) => row(child, plateId, depth + 1))}</Box>
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
        {plates.map((plate) => {
          const active = plate.id === activePlate;
          const expanded = plateExpansion[plate.id] ?? active;
          const roots = rootsByPlate.get(plate.id) ?? [];
          return (
            <Box key={plate.id} role="treeitem" aria-label={plate.name} aria-expanded={expanded} aria-current={active}>
              <ListItemButton
                dense
                selected={active}
                aria-label={plate.name}
                onClick={() => activatePlate(plate.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  expandPlate(plate.id, event.key === "ArrowRight");
                }}
                sx={{ borderRadius: 1, px: 0.5, py: 0.25, gap: 0.5, minHeight: 32 }}
              >
                <IconButton
                  size="small"
                  aria-label={`${t(expanded ? "studio.tree.collapse" : "studio.tree.expand")} ${plate.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    expandPlate(plate.id, !expanded);
                  }}
                  sx={{ p: 0, color: "text.secondary" }}
                >
                  <ChevronRightIcon sx={{ fontSize: 18, transform: expanded ? "rotate(90deg)" : "none" }} />
                </IconButton>
                <LayersOutlinedIcon
                  sx={{ fontSize: 18, color: active ? "primary.main" : "text.secondary", flexShrink: 0 }}
                />
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: active ? 600 : 500 }}>
                  {plate.name}
                </Typography>
                {canEditPlates && (
                  <Tooltip title={t("studio.plates.actions")}>
                    <IconButton
                      size="small"
                      aria-haspopup="menu"
                      aria-label={`${t("studio.plates.actions")}: ${plate.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPlateMenu({ id: plate.id, anchor: event.currentTarget });
                      }}
                      sx={{ p: 0.25 }}
                    >
                      <MoreVertIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </ListItemButton>
              {expanded && (
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                <Box role="group">
                  {roots.length ? (
                    roots.map((feature) => row(feature, plate.id, 0))
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ pl: 3, pr: 1, py: 0.75 }}>
                      {t("studio.tree.empty")}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      {canEditPlates && (
        <>
          <Menu anchorEl={plateMenu?.anchor} open={Boolean(menuPlate)} onClose={() => setPlateMenu(null)}>
            <MenuItem
              disabled={
                !menuPlate || !rootsByPlate.get(menuPlate.id)?.some((feature) => isBody(feature) && feature.visible)
              }
              onClick={() => {
                if (menuPlate) onArrange(menuPlate.id);
                setPlateMenu(null);
              }}
            >
              {t("studio.print.arrange")}
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (menuPlate) setPlateDialog({ kind: "rename", id: menuPlate.id });
                setPlateMenu(null);
              }}
            >
              {t("studio.plates.rename")}
            </MenuItem>
            <MenuItem
              disabled={!menuPlate || menuPlate.id === DEFAULT_PLATE_ID || rootsByPlate.has(menuPlate.id)}
              onClick={() => {
                if (menuPlate) void run("delete_plate", { plate_id: menuPlate.id });
                setPlateMenu(null);
              }}
            >
              {t("studio.plates.delete")}
            </MenuItem>
          </Menu>
          <RenameDialog
            value={
              plateDialog?.kind === "create"
                ? t("studio.plates.defaultName", { count: document?.next_plate_id ?? plates.length + 1 })
                : (renamePlate?.name ?? null)
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
        </>
      )}
    </SidePanel>
  );
}
