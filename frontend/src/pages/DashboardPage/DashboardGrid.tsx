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
import { widgetById } from "./widgets";
import { CARD_BODY_CLASS } from "./DashboardCard";
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
  onOpenSettings: (panelId: string) => void;
  /** A panel to size to its content, once it has rendered; `at` makes asking again for the same panel a new ask. */
  fitRequest: { panelId: string; at: number } | null;
  onRequestFit: (panelId: string) => void;
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
  onOpenSettings,
  fitRequest,
  onRequestFit,
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
  // Sizes a panel to its content a frame after the change that asked, once it has rendered. Each ask is handled
  // once, however often the layout changes meanwhile.
  const fitted = React.useRef<typeof fitRequest>(null);
  React.useEffect(() => {
    if (!fitRequest || fitted.current === fitRequest) return;
    const frame = window.requestAnimationFrame(() => {
      fitted.current = fitRequest;
      const element = containerRef.current?.querySelector<HTMLElement>(`[data-panel="${fitRequest.panelId}"]`);
      const item = layout.find((cell) => cell.i === fitRequest.panelId);
      if (!element || !item) return;
      const needed = rowsFor(naturalHeight(element));
      if (needed === item.h) return;
      const items = nudgeLayout(layout, item.i, 0, needed - item.h, true, cols, scaledMin(item.i));
      onChange((current) => setLayout(current, breakpoint.id, items));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitRequest, layout, cols, scaledMin, onChange, breakpoint.id, containerRef]);

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
                <div key={panel.id} data-panel={panel.id}>
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
                    onFit={() => onRequestFit(panel.id)}
                    onOpenSettings={
                      panel.widgets.some((id) => widgetById(id)?.settings?.length)
                        ? () => onOpenSettings(panel.id)
                        : undefined
                    }
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

/** The fewest rows that hold `px` pixels: a panel of h rows is h rows plus the gaps between them. */
function rowsFor(px: number): number {
  return Math.max(1, Math.ceil((px + GRID_GAP) / (ROW_HEIGHT + GRID_GAP)));
}

/**
 * How tall a panel would be with nothing scrolled or stretched. A list card stacks from its top, so it's the card down
 * to the end of its last block, plus whatever its body has scrolled out of sight; anything around the card, like a
 * tab strip, adds on. Another card is measured by what it would scroll.
 */
function naturalHeight(panel: HTMLElement): number {
  const body = panel.querySelector<HTMLElement>(`.${CARD_BODY_CLASS}`);
  const card = body?.parentElement;
  if (body && card) {
    const style = getComputedStyle(card);
    const top = card.getBoundingClientRect().top;
    const end = Array.from(card.children).reduce((max, child) => {
      const box = child.getBoundingClientRect();
      return box.height ? Math.max(max, box.bottom + parseFloat(getComputedStyle(child).marginBottom)) : max;
    }, top);
    const content =
      end -
      top +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderBottomWidth) +
      body.scrollHeight -
      body.clientHeight;
    return panel.clientHeight - card.offsetHeight + content;
  }
  const cards = panel.querySelectorAll<HTMLElement>(".MuiPaper-root");
  const inner = cards[cards.length - 1];
  return inner ? panel.clientHeight - inner.clientHeight + inner.scrollHeight : panel.clientHeight;
}
