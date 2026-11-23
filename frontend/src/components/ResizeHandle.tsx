import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

/** The arrow keys' step, and Shift's bigger one, in px. */
const STEP = 16;
const BIG_STEP = 64;

/** The width a key on the handle asks for, or null for a key it doesn't take. */
export function keyedWidth(
  key: string,
  shift: boolean,
  width: number,
  { min, max, edge }: { min: number; max: number; edge: "left" | "right" },
): number | null {
  const step = shift ? BIG_STEP : STEP;
  // The arrow pointing away from the panel widens it.
  const wider = edge === "right" ? "ArrowRight" : "ArrowLeft";
  const narrower = edge === "right" ? "ArrowLeft" : "ArrowRight";
  if (key === wider) return Math.min(max, width + step);
  if (key === narrower) return Math.max(min, width - step);
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

type WidthLimits = {
  min: number;
  max: number;
  /** The most of the window's width it may take, 0 to 1. */
  share: number;
};

/** The widest a panel may be in a window this wide: its own maximum, or its share of the window when that's less. */
export function widthLimit(windowWidth: number, { min, max, share }: WidthLimits): number {
  return Math.max(min, Math.min(max, Math.floor(windowWidth * share)));
}

/** A panel's width for a ResizeHandle. The width shown stays within the window's limit, and one asked for in a wider
 *  window comes back when the window grows again. Kept for as long as the page that holds it. */
export function useResizableWidth(initial: number, limits: WidthLimits) {
  const [asked, setAsked] = useState(initial);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const max = widthLimit(windowWidth, limits);
  return { width: Math.min(asked, max), max, setWidth: setAsked };
}

type Props = {
  /** The panel's edge it sits on; the panel's box has to be positioned. */
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  /** Where a double-click puts it back. */
  defaultWidth: number;
  onChange: (width: number) => void;
  /** What it resizes, for a screen reader. */
  label: string;
  /** How to use it, shown on hover. */
  hint: string;
};

/** A side panel's resizable edge: a pill to drag, or arrow keys once it has focus, as a window splitter. */
export default function ResizeHandle({ edge, width, min, max, defaultWidth, onChange, label, hint }: Props) {
  // Where the drag started, and the page's own user-select to put back after it.
  const drag = useRef<{ x: number; width: number; userSelect: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));
  const release = () => {
    if (drag.current) document.body.style.userSelect = drag.current.userSelect;
    drag.current = null;
  };
  const end = () => {
    release();
    setDragging(false);
  };
  // Leaving the page mid-drag: a removed handle gets no lostpointercapture.
  useEffect(
    () => () => {
      if (drag.current) document.body.style.userSelect = drag.current.userSelect;
    },
    [],
  );
  return (
    <Tooltip title={hint} placement={edge === "right" ? "right" : "left"} open={hovered && !dragging}>
      <Box
        // A splitter is a separator that takes focus and moves, which an hr, being empty and inert, can't be.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width, userSelect: document.body.style.userSelect };
          setDragging(true);
          // Dragging across the tree shouldn't select its text.
          document.body.style.userSelect = "none";
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const moved = event.clientX - drag.current.x;
          onChange(clamp(drag.current.width + (edge === "right" ? moved : -moved)));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => onChange(defaultWidth)}
        onKeyDown={(event) => {
          const next = keyedWidth(event.key, event.shiftKey, width, { min, max, edge });
          if (next === null) return;
          event.preventDefault();
          onChange(next);
        }}
        sx={{
          position: "absolute",
          top: 0,
          bottom: 0,
          [edge]: -5,
          width: 10,
          zIndex: 2,
          cursor: "col-resize",
          touchAction: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          outline: "none",
          "& > span": {
            width: 4,
            height: 32,
            borderRadius: 2,
            bgcolor: "divider",
            border: 1,
            borderColor: "text.disabled",
            opacity: 0.6,
            transition: "transform 150ms, opacity 150ms, background-color 150ms, border-color 150ms",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          },
          "&:hover > span, &:focus-visible > span, &[data-dragging] > span": {
            bgcolor: "primary.main",
            borderColor: "primary.main",
            opacity: 1,
            transform: "scaleY(1.4)",
          },
          "&:focus-visible > span": {
            outline: 2,
            outlineStyle: "solid",
            outlineColor: "primary.main",
            outlineOffset: 2,
          },
        }}
      >
        <span />
      </Box>
    </Tooltip>
  );
}
