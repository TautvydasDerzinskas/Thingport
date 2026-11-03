import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { featureById, inputsOf, topLevel, type Feature, type StudioDocument } from "../../studio/document";
import { FeatureIcon, IntersectIcon, SubtractIcon, UnionIcon } from "./studioIcons";
import { featureLabel } from "./labels";

type Props = {
  document: StudioDocument;
  selected: readonly string[];
  errors: Record<string, string>;
  onSelect: (id: string, additive: boolean) => void;
  onMenu: (id: string, at: { top: number; left: number }) => void;
  onToggleVisible: (feature: Feature) => void;
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

/** The design's features as a tree: what shows on its own at the top, what each is built from folded under it. */
export default function FeatureTree({ document, selected, errors, onSelect, onMenu, onToggleVisible }: Props) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const roots = topLevel(document);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (feature: Feature, depth: number): React.ReactNode => {
    const children = inputsOf(feature)
      .map((id) => featureById(document, id))
      .filter((child): child is Feature => Boolean(child));
    const expanded = open.has(feature.id);
    const chosen = selected.includes(feature.id);
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
        aria-selected={chosen}
      >
        <ListItemButton
          dense
          selected={chosen}
          onClick={(event) => onSelect(feature.id, event.shiftKey || event.metaKey || event.ctrlKey)}
          onContextMenu={(event) => {
            event.preventDefault();
            onMenu(feature.id, { top: event.clientY, left: event.clientX });
          }}
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
            pl: 0.5 + depth * 1.5,
            pr: 0.25,
            py: 0.25,
            gap: 0.5,
            minHeight: 32,
            opacity: feature.visible || depth > 0 ? 1 : 0.5,
            "& .row-action": { opacity: chosen ? 1 : 0, transition: "opacity 150ms" },
            "&:hover .row-action, &:focus-visible .row-action": { opacity: 1 },
          }}
        >
          <Box
            component="span"
            role={children.length ? "button" : undefined}
            aria-label={children.length ? (expanded ? t("studio.tree.collapse") : t("studio.tree.expand")) : undefined}
            onClick={(event) => {
              if (!children.length) return;
              event.stopPropagation();
              toggle(feature.id);
            }}
            sx={{ display: "inline-flex", width: 18, color: "text.secondary", flexShrink: 0 }}
          >
            {children.length > 0 && (
              <ChevronRightIcon
                sx={{
                  fontSize: 18,
                  transform: expanded ? "rotate(90deg)" : "none",
                  transition: "transform 150ms",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
            )}
          </Box>
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
          {depth === 0 && (
            <Tooltip title={feature.visible ? t("studio.actions.hide") : t("studio.actions.show")}>
              <IconButton
                className="row-action"
                size="small"
                aria-label={`${feature.visible ? t("studio.actions.hide") : t("studio.actions.show")}: ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisible(feature);
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
          <Tooltip title={t("common:moreActions")}>
            <IconButton
              className="row-action"
              size="small"
              aria-label={`${t("common:moreActions")}: ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onMenu(feature.id, menuAt(event.currentTarget));
              }}
              sx={{ p: 0.25 }}
            >
              <MoreVertIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </ListItemButton>
        {expanded && (
          // A tree item's children are a group, which no HTML element is.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          <Box role="group">{children.map((child) => row(child, depth + 1))}</Box>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <Typography
        variant="caption"
        sx={{ px: 1.5, pt: 1.25, pb: 0.5, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
      >
        {t("studio.tree.heading")}
      </Typography>
      <Box role="tree" aria-label={t("studio.tree.heading")} sx={{ flex: 1, overflow: "auto", px: 0.75, pb: 1 }}>
        {roots.length ? (
          roots.map((feature) => row(feature, 0))
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
            {t("studio.tree.empty")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
