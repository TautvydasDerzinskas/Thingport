import React from "react";
import { keyframes } from "@emotion/react";
import GridLayout, { useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import type { DashboardTemplate, DashboardWidgetId } from "../../api/settings";
import DashboardPanel, { DRAG_HANDLE, NO_DRAG, WidgetChipFace, type ChipDragData } from "./DashboardPanel";
import {
  GRID_GAP,
  ROW_HEIGHT,
  breakpointFor,
  detachWidget,
  moveWidgetToPanel,
  nudgeLayout,
  panelMinSize,
  resolveLayout,
  setLayout,
  setTab,
  splitPanel,
} from "./templates";

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

// Empty rows drawn below the panels while editing, so there's somewhere to drag one to.
const SPARE_ROWS = 3;
const GRID_DROP_ID = "grid";

// A chip over a panel merges into it; anywhere else on the grid it means "give it a panel of its own".
const panelFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const panel = hits.find((hit) => String(hit.id).startsWith("panel:"));
  return panel ? [panel] : hits;
};

type Props = {
  template: DashboardTemplate;
  editing: boolean;
  isSelected: (panelId: string) => boolean;
  onToggleSelected: (panelId: string, range: boolean) => void;
  onChange: (change: (template: DashboardTemplate) => DashboardTemplate) => void;
  onRemove: (panelId: string) => void;
  renderWidget: (id: DashboardWidgetId) => React.ReactNode;
  keysHintId: string;
};

export default function DashboardGrid({
  template,
  editing,
  isSelected,
  onToggleSelected,
  onChange,
  onRemove,
  renderWidget,
  keysHintId,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const breakpoint = breakpointFor(width);
  const cols = breakpoint.cols;
  const [dragging, setDragging] = React.useState<ChipDragData | null>(null);
  const justArranged = React.useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const { setNodeRef: setGridDropRef } = useDroppable({ id: GRID_DROP_ID, disabled: !editing });

  const minSizes = React.useMemo(
    () => new Map(template.panels.map((panel) => [panel.id, panelMinSize(panel)])),
    [template.panels],
  );
  const scaledMin = React.useCallback(
    (panelId: string) => {
      const min = minSizes.get(panelId) ?? { minW: 1, minH: 1 };
      // The minimum width is in the wide grid's columns.
      return { minW: Math.min(cols, Math.max(1, Math.ceil((min.minW * cols) / 12))), minH: min.minH };
    },
    [minSizes, cols],
  );
  const layout = React.useMemo(() => resolveLayout(template, breakpoint.id), [template, breakpoint.id]);
  const gridLayout: Layout = React.useMemo(
    () => layout.map((item) => ({ ...item, ...scaledMin(item.i) })),
    [layout, scaledMin],
  );
  const rows = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0) + (editing ? SPARE_ROWS : 0);

  // The click that ends a move or resize lands on the panel, and shouldn't also select it. It comes straight after
  // the pointer is let go, before the timer clears the flag.
  const markArranged = () => {
    justArranged.current = true;
    window.setTimeout(() => (justArranged.current = false), 0);
  };

  const save = (items: Layout) => {
    markArranged();
    onChange((current) => setLayout(current, breakpoint.id, items));
  };
  const onArranged = (items: Layout, from: LayoutItem | null, to: LayoutItem | null) => {
    markArranged();
    if (from && to && (from.x !== to.x || from.y !== to.y || from.w !== to.w || from.h !== to.h)) save(items);
  };

  const onDragStart = (event: DragStartEvent) => setDragging(event.active.data.current as ChipDragData);
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    markArranged();
    const chip = event.active.data.current as ChipDragData;
    const over = event.over?.data.current as { panelId?: string } | undefined;
    if (over?.panelId) onChange((current) => moveWidgetToPanel(current, chip.widgetId, over.panelId!));
    else if (event.over?.id === GRID_DROP_ID) onChange((current) => detachWidget(current, chip.widgetId));
  };

  return (
    <Box ref={containerRef} sx={{ position: "relative" }}>
      {mounted && (
        <DndContext
          sensors={sensors}
          collisionDetection={panelFirst}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <Box
            ref={setGridDropRef}
            sx={(theme) => ({
              position: "relative",
              minHeight: rows * (ROW_HEIGHT + GRID_GAP) - GRID_GAP,
              // The grid's look while editing, in the theme's colours: the placeholder where a panel will land and
              // the corner it resizes from.
              "& .react-grid-item": {
                transition: "transform 200ms ease, width 200ms ease, height 200ms ease",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
              },
              "& .react-grid-item.react-draggable-dragging, & .react-grid-item.resizing": {
                transition: "none",
                zIndex: 3,
                boxShadow: theme.shadows[8],
                borderRadius: `${theme.shape.borderRadius}px`,
              },
              "& .react-grid-item.react-grid-placeholder": {
                bgcolor: alpha(theme.palette.primary.main, 0.15),
                border: `2px dashed ${theme.palette.primary.main}`,
                borderRadius: `${theme.shape.borderRadius}px`,
                zIndex: 2,
                transition: "transform 100ms ease, width 100ms ease, height 100ms ease",
              },
              "& .react-resizable-handle": editing
                ? {
                    position: "absolute",
                    right: 2,
                    bottom: 2,
                    width: 18,
                    height: 18,
                    cursor: "se-resize",
                    zIndex: 1,
                    borderRight: `3px solid ${theme.palette.primary.main}`,
                    borderBottom: `3px solid ${theme.palette.primary.main}`,
                    borderBottomRightRadius: `${theme.shape.borderRadius}px`,
                    opacity: 0.7,
                    transition: "opacity 150ms ease",
                    "&:hover": { opacity: 1 },
                  }
                : { display: "none" },
            })}
          >
            {editing && <GridCells cols={cols} rows={rows} />}
            <GridLayout
              width={width}
              layout={gridLayout}
              gridConfig={{ cols, rowHeight: ROW_HEIGHT, margin: [GRID_GAP, GRID_GAP], containerPadding: [0, 0] }}
              dragConfig={{ enabled: editing, handle: `.${DRAG_HANDLE}`, cancel: `.${NO_DRAG}` }}
              resizeConfig={{ enabled: editing, handles: ["se"] }}
              onDragStop={onArranged}
              onResizeStop={onArranged}
            >
              {template.panels.map((panel) => (
                <div key={panel.id}>
                  <DashboardPanel
                    panel={panel}
                    renderWidget={renderWidget}
                    onTabChange={(tab) => onChange((current) => setTab(current, panel.id, tab))}
                    editing={editing}
                    selected={isSelected(panel.id)}
                    onToggleSelected={(range) => onToggleSelected(panel.id, range)}
                    onNudge={({ dx, dy, resize }) =>
                      save(nudgeLayout(layout, panel.id, dx, dy, resize, cols, scaledMin(panel.id)))
                    }
                    onSplit={() => onChange((current) => splitPanel(current, panel.id))}
                    onRemove={() => onRemove(panel.id)}
                    justArranged={() => justArranged.current}
                    dragging={dragging}
                    keysHintId={keysHintId}
                  />
                </div>
              ))}
            </GridLayout>
          </Box>
          <DragOverlay dropAnimation={null}>
            {dragging && <WidgetChipFace widgetId={dragging.widgetId} lifted />}
          </DragOverlay>
        </DndContext>
      )}
    </Box>
  );
}

/** The grid's cells, faintly outlined behind the panels while editing. */
function GridCells({ cols, rows }: { cols: number; rows: number }) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: ROW_HEIGHT,
        gap: `${GRID_GAP}px`,
        pointerEvents: "none",
        animation: `${fadeIn} 200ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        "& > div": {
          border: `1px dashed ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.14 : 0.16)}`,
          borderRadius: `${theme.shape.borderRadius}px`,
        },
      })}
    >
      {Array.from({ length: cols * rows }, (_, index) => (
        <div key={index} />
      ))}
    </Box>
  );
}
