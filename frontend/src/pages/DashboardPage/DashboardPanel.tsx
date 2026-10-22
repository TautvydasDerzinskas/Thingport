import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import HeightIcon from "@mui/icons-material/Height";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import TabIcon from "@mui/icons-material/TabOutlined";
import type { DashboardPanel as Panel, WidgetInstanceId } from "../../api/settings";
import SelectionCheck from "../../components/selection/SelectionCheck";
import { TabbedCardContext, cardBorder } from "./DashboardCard";
import { widgetById } from "./widgets";

/** RGL's drag handle and the elements inside it that mustn't start a move. */
export const DRAG_HANDLE = "dashboard-drag-handle";
export const NO_DRAG = "dashboard-no-drag";

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;
const tabIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
`;

/** What a widget chip carries while dragged. */
export type ChipDragData = { widgetId: WidgetInstanceId; panelId: string };

export type NudgeKey = { dx: number; dy: number; resize: boolean };

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

type Props = {
  panel: Panel;
  renderWidget: (id: WidgetInstanceId) => React.ReactNode;
  onTabChange: (tab: number) => void;
  editing: boolean;
  selected: boolean;
  onToggleSelected: (range: boolean) => void;
  onNudge: (key: NudgeKey) => void;
  onSplit: () => void;
  onRemove: () => void;
  /** Sizes the panel to fit its content. */
  onFit: () => void;
  /** Opens the panel's options; missing when none of its widgets has any. */
  onOpenSettings?: () => void;
  /** True right after a move or resize ended, when the click that ends it shouldn't also select. */
  justArranged: () => boolean;
  /** The widget chip being dragged, from any panel. */
  dragging: ChipDragData | null;
  /** Describes the keyboard controls, for the edit overlay's aria-describedby. */
  keysHintId: string;
};

export default function DashboardPanel({
  panel,
  renderWidget,
  onTabChange,
  editing,
  selected,
  onToggleSelected,
  onNudge,
  onSplit,
  onRemove,
  onFit,
  onOpenSettings,
  justArranged,
  dragging,
  keysHintId,
}: Props) {
  const { t } = useTranslation("app");
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = React.useState<{ anchor: HTMLElement } | { x: number; y: number } | null>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: `panel:${panel.id}`,
    data: { panelId: panel.id },
    disabled: !editing,
  });
  const tabbed = panel.widgets.length > 1;
  const tab = Math.min(panel.tab ?? 0, panel.widgets.length - 1);
  const name = panel.widgets.map((id) => t(widgetById(id)?.labelKey ?? "")).join(", ");
  // A chip from another panel hovering here: dropping it adds a tab.
  const mergeTarget = isOver && dragging !== null && dragging.panelId !== panel.id;

  // While editing, the widget underneath is only a picture: nothing in it can be clicked or tabbed to.
  React.useEffect(() => {
    if (contentRef.current) contentRef.current.inert = editing;
  }, [editing]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggleSelected(event.shiftKey);
    } else if (ARROWS[event.key]) {
      event.preventDefault();
      const [dx, dy] = ARROWS[event.key];
      onNudge({ dx, dy, resize: event.shiftKey });
    }
  };

  const content = tabbed ? (
    <Paper
      variant="outlined"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderColor: cardBorder,
      }}
    >
      <Tabs
        value={tab}
        onChange={(_, value: number) => onTabChange(value)}
        variant="scrollable"
        scrollButtons={false}
        aria-label={name}
        sx={{ minHeight: 44, px: 1, flexShrink: 0, borderBottom: 1, borderColor: "divider" }}
      >
        {panel.widgets.map((id, index) => {
          const widget = widgetById(id);
          return (
            <Tab
              key={id}
              id={`${panel.id}-tab-${index}`}
              aria-controls={`${panel.id}-tabpanel`}
              icon={widget?.icon as React.ReactElement}
              iconPosition="start"
              label={t(widget?.labelKey ?? "")}
              sx={{ minHeight: 44, minWidth: 0, px: 1.5, py: 0, gap: 0.75, textTransform: "none", fontWeight: 600 }}
            />
          );
        })}
      </Tabs>
      <Box
        key={panel.widgets[tab]}
        id={`${panel.id}-tabpanel`}
        role="tabpanel"
        aria-labelledby={`${panel.id}-tab-${tab}`}
        sx={{
          flex: 1,
          minHeight: 0,
          animation: `${tabIn} 180ms ease-out`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        <TabbedCardContext.Provider value>{renderWidget(panel.widgets[tab])}</TabbedCardContext.Provider>
      </Box>
    </Paper>
  ) : (
    renderWidget(panel.widgets[0])
  );

  return (
    <Box ref={setNodeRef} sx={{ position: "relative", height: "100%" }}>
      <Box ref={contentRef} aria-hidden={editing || undefined} sx={{ height: "100%" }}>
        {content}
      </Box>
      {editing && (
        <Box
          className={DRAG_HANDLE}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            borderRadius: `${theme.shape.borderRadius}px`,
            cursor: "grab",
            userSelect: "none",
            display: "flex",
            flexDirection: "column",
            p: 1,
            outline: "2px dashed",
            outlineOffset: -1,
            outlineColor:
              selected || mergeTarget ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.25),
            ...((selected || mergeTarget) && { outlineStyle: "solid" }),
            // The widget shows faintly through, so the panel is recognisable without its title fighting the chips.
            bgcolor: alpha(theme.palette.background.paper, 0.8),
            backdropFilter: "blur(2px)",
            backgroundImage: mergeTarget
              ? `linear-gradient(${alpha(theme.palette.primary.main, 0.22)}, ${alpha(theme.palette.primary.main, 0.22)})`
              : selected
                ? `linear-gradient(${alpha(theme.palette.primary.main, 0.12)}, ${alpha(theme.palette.primary.main, 0.12)})`
                : "none",
            transition: "background-color 150ms ease, outline-color 150ms ease",
            animation: `${fadeIn} 150ms ease-out`,
            "&:hover, &:has(> button:focus-visible)": { outlineColor: theme.palette.primary.main },
            "&:has(> button:focus-visible)": { outlineStyle: "solid", outlineWidth: 3 },
            ".react-draggable-dragging &": { cursor: "grabbing" },
            // Only the chips and the menu button take the pointer; the rest of the bar lets it through to the
            // button underneath.
            "& > :not(button)": { position: "relative", pointerEvents: "none" },
            [`& .${NO_DRAG}`]: { pointerEvents: "auto" },
            "@media (prefers-reduced-motion: reduce)": { animation: "none", transition: "none" },
          })}
        >
          {/* The whole panel selects, and takes the keyboard's moves; the chips and menu sit above it. */}
          <Box
            component="button"
            type="button"
            aria-pressed={selected}
            aria-label={t("dashboard.edit.panelLabel", { name })}
            aria-describedby={keysHintId}
            onClick={(event: React.MouseEvent) => {
              if (!justArranged()) onToggleSelected(event.shiftKey);
            }}
            onKeyDown={onKeyDown}
            sx={{
              position: "absolute",
              inset: 0,
              p: 0,
              border: 0,
              borderRadius: "inherit",
              bgcolor: "transparent",
              cursor: "inherit",
              outline: "none",
            }}
          />
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, minWidth: 0 }}>
            <SelectionCheck selected={selected} sx={{ position: "static", flexShrink: 0 }} />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, flex: 1, minWidth: 0 }}>
              {panel.widgets.map((id) => (
                <WidgetChip
                  key={id}
                  widgetId={id}
                  panelId={panel.id}
                  tabbed={tabbed}
                  hidden={dragging?.widgetId === id}
                />
              ))}
            </Box>
            {onOpenSettings && (
              <Tooltip title={t("dashboard.settings.open")}>
                <IconButton
                  className={NO_DRAG}
                  size="small"
                  aria-label={t("dashboard.settings.openFor", { name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSettings();
                  }}
                  sx={{ bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}
                >
                  <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t("dashboard.edit.panelActions")}>
              <IconButton
                className={NO_DRAG}
                size="small"
                aria-label={t("dashboard.edit.panelActions")}
                aria-haspopup="menu"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu({ anchor: event.currentTarget });
                }}
                sx={{ bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          {mergeTarget && (
            <Box
              aria-hidden
              sx={{
                m: "auto",
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1.5,
                py: 0.75,
                borderRadius: 999,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                boxShadow: 3,
                animation: `${tabIn} 150ms ease-out`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            >
              <TabIcon fontSize="small" />
              <Typography variant="body2" fontWeight={600}>
                {t("dashboard.edit.mergeHere")}
              </Typography>
            </Box>
          )}
        </Box>
      )}
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorEl={menu && "anchor" in menu ? menu.anchor : undefined}
        anchorReference={menu && "anchor" in menu ? "anchorEl" : "anchorPosition"}
        anchorPosition={menu && "x" in menu ? { left: menu.x, top: menu.y } : undefined}
        // Keeps a click on the menu from reaching the panel underneath and selecting it.
        onClick={(event) => event.stopPropagation()}
      >
        {onOpenSettings && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              onOpenSettings();
            }}
          >
            <ListItemIcon>
              <SettingsOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.settings.open")}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenu(null);
            onFit();
          }}
        >
          <ListItemIcon>
            <HeightIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("dashboard.edit.fit")}</ListItemText>
        </MenuItem>
        <Divider />
        {tabbed && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              onSplit();
            }}
          >
            <ListItemIcon>
              <CallSplitIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.edit.split")}</ListItemText>
          </MenuItem>
        )}
        {tabbed && <Divider />}
        <MenuItem
          onClick={() => {
            setMenu(null);
            onRemove();
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("dashboard.edit.removePanel")}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

/** A widget's name on a panel being edited. Dragging it onto another panel adds it there as a tab. */
function WidgetChip({
  widgetId,
  panelId,
  tabbed,
  hidden,
}: {
  widgetId: WidgetInstanceId;
  panelId: string;
  tabbed: boolean;
  hidden: boolean;
}) {
  const { t } = useTranslation("app");
  const data: ChipDragData = { widgetId, panelId };
  const { setNodeRef, attributes, listeners } = useDraggable({ id: `widget:${widgetId}`, data });
  return (
    <Tooltip title={t(tabbed ? "dashboard.edit.dragTab" : "dashboard.edit.dragToMerge")}>
      <Box
        ref={setNodeRef}
        className={NO_DRAG}
        {...attributes}
        {...listeners}
        aria-label={`${t(widgetById(widgetId)?.labelKey ?? "")}. ${t(tabbed ? "dashboard.edit.dragTab" : "dashboard.edit.dragToMerge")}`}
        sx={{ opacity: hidden ? 0.35 : 1, transition: "opacity 150ms ease", maxWidth: "100%" }}
      >
        <WidgetChipFace widgetId={widgetId} />
      </Box>
    </Tooltip>
  );
}

/** The chip's look, shared with the copy that follows the pointer while it's dragged. */
export function WidgetChipFace({ widgetId, lifted = false }: { widgetId: WidgetInstanceId; lifted?: boolean }) {
  const { t } = useTranslation("app");
  const widget = widgetById(widgetId);
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        maxWidth: "100%",
        px: 1,
        py: 0.25,
        borderRadius: 999,
        border: 1,
        borderColor: lifted ? "primary.main" : "divider",
        bgcolor: "background.paper",
        boxShadow: lifted ? 6 : 1,
        color: "text.primary",
        cursor: lifted ? "grabbing" : "grab",
        transform: lifted ? "rotate(-2deg) scale(1.04)" : "none",
        "& svg": { color: "primary.main", fontSize: 16 },
        "@media (prefers-reduced-motion: reduce)": { transform: "none" },
      }}
    >
      {widget?.icon}
      <Typography variant="caption" fontWeight={600} noWrap>
        {t(widget?.labelKey ?? "")}
      </Typography>
    </Box>
  );
}
