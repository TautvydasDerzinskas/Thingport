import { useId, type ReactNode } from "react";
import Box from "@mui/material/Box";

// A small picture of each print-profile choice that has a look (infill and top patterns, supports, brim, seam, walls,
// ironing, fuzzy skin), drawn in the current colour so it follows the theme: lines in the accent, the part's body as a
// faint fill. A 48-unit square; seen from above unless a side view says more.

const ln = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const thick = { ...ln, strokeWidth: 2.4 };
const faint = { ...ln, opacity: 0.4 };
const body = { fill: "currentColor", opacity: 0.22 };
const bed = { fill: "currentColor", opacity: 0.14 };

/** A part's outline from above, with `inside` clipped to it. */
function Outline({ clip, children }: { clip: string; children?: ReactNode }) {
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <rect x="7" y="7" width="34" height="34" rx="2" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>{children}</g>
      <rect x="7" y="7" width="34" height="34" rx="2" {...thick} />
    </>
  );
}

const lines = (d: string, style: object = ln) => <path d={d} {...style} />;

const INFILL: Record<string, (clip: string) => ReactNode> = {
  grid: (clip) => (
    <Outline clip={clip}>
      {lines("M-10 30 L30 -10 M-10 46 L46 -10 M-2 54 L54 -2 M14 54 L54 14 M-6 -2 L50 54 M-10 10 L38 58 M10 -10 L58 38")}
    </Outline>
  ),
  "zig-zag": (clip) => (
    <Outline clip={clip}>
      {lines("M-10 22 L22 -10 M-10 30 L30 -10 M-10 38 L38 -10 M-10 46 L46 -10 M-2 54 L54 -2 M6 54 L54 6 M14 54 L54 14")}
    </Outline>
  ),
  gyroid: (clip) => (
    <Outline clip={clip}>
      {lines(
        "M2 12 C8 6, 12 18, 18 12 S28 6, 34 12 S44 18, 50 12 M2 20 C8 14, 12 26, 18 20 S28 14, 34 20 S44 26, 50 20 M2 28 C8 22, 12 34, 18 28 S28 22, 34 28 S44 34, 50 28 M2 36 C8 30, 12 42, 18 36 S28 30, 34 36 S44 42, 50 36",
      )}
    </Outline>
  ),
  cubic: (clip) => (
    <Outline clip={clip}>{lines("M18 0 V48 M30 0 V48 M0 8 L48 36 M0 24 L48 52 M0 36 L48 8 M0 52 L48 24")}</Outline>
  ),
  adaptivecubic: (clip) => (
    <Outline clip={clip}>
      {lines("M7 11 H41 M7 37 H41 M11 7 V41 M37 7 V41 M7 15 H41 M7 33 H41 M15 7 V41 M33 7 V41")}
      {lines("M15 15 L33 33 M33 15 L15 33", faint)}
    </Outline>
  ),
  triangles: (clip) => (
    <Outline clip={clip}>
      {lines("M0 18 H48 M0 30 H48 M-4 40 L20 -2 M8 46 L34 0 M20 52 L46 6 M2 0 L28 46 M14 0 L40 46")}
    </Outline>
  ),
  honeycomb: (clip) => (
    <Outline clip={clip}>
      {lines(
        "M6 14 l4 -6 h7 l4 6 l-4 6 h-7 z M21 14 h6 M27 14 l4 -6 h7 l4 6 l-4 6 h-7 z M13 20 l4 6 l-4 6 h-7 l-4 -6 l4 -6 M17 26 h7 l4 -6 M28 20 l4 6 l-4 6 M32 26 h7 l4 -6 M13 32 l4 6 h7 l4 -6 M28 32 l4 6 h7 l4 -6",
      )}
    </Outline>
  ),
  lightning: (clip) => (
    <Outline clip={clip}>
      {lines("M24 7 V20 L16 28 L12 41 M20 24 L28 32 L30 41 M24 20 L32 24 L41 30 M32 24 L36 14")}
    </Outline>
  ),
  concentric: (clip) => (
    <Outline clip={clip}>
      <rect x="12" y="12" width="24" height="24" rx="2" {...ln} />
      <rect x="17" y="17" width="14" height="14" rx="1.5" {...ln} />
      <rect x="21.5" y="21.5" width="5" height="5" rx="1" {...ln} />
    </Outline>
  ),
};

const arrow = lines("M33 37 L39 31 M39 31 H35 M39 31 V35", { ...ln, strokeWidth: 1.6 });

const TOP: Record<string, (clip: string) => ReactNode> = {
  monotonic: (clip) => (
    <>
      <Outline clip={clip}>
        {lines("M-10 22 L22 -10 M-10 28 L28 -10 M-10 34 L34 -10 M-10 40 L40 -10 M-10 46 L46 -10")}
      </Outline>
      {arrow}
    </>
  ),
  monotonicline: (clip) => (
    <>
      <Outline clip={clip}>{lines("M-10 22 L22 -10 M-10 32 L32 -10 M-10 42 L42 -10")}</Outline>
      {arrow}
    </>
  ),
  "zig-zag": (clip) => (
    <Outline clip={clip}>
      {lines("M7 15 L15 7 L21 7 L7 21 L7 27 L27 7 L33 7 L7 33 L7 39 L39 7 L41 11 L11 41 L17 41 L41 17 L41 23 L23 41")}
    </Outline>
  ),
  concentric: INFILL.concentric,
};

// From the side: a bed, a part with an overhang, and what holds it up.
const overhang = (
  <>
    <rect x="4" y="40" width="40" height="3" rx="1" {...bed} />
    <rect x="8" y="10" width="32" height="7" rx="1" {...body} />
    <rect x="8" y="17" width="7" height="23" {...body} />
  </>
);

const SUPPORT: Record<string, () => ReactNode> = {
  "normal(auto)": () => (
    <>
      {overhang}
      {lines("M19 18 V40 M24 18 V40 M29 18 V40 M34 18 V40 M19 23 H37 M19 31 H37")}
    </>
  ),
  "tree(auto)": () => (
    <>
      {overhang}
      {lines("M28 40 V30 M28 30 L20 18 M28 30 V18 M28 30 L36 18", { ...ln, strokeWidth: 2 })}
    </>
  ),
};

const part = <rect x="14" y="14" width="20" height="20" rx="2" {...body} />;

const BRIM: Record<string, () => ReactNode> = {
  no_brim: () => part,
  outer_only: () => (
    <>
      <rect x="6" y="6" width="36" height="36" rx="6" {...ln} />
      <rect x="9" y="9" width="30" height="30" rx="5" {...ln} />
      <rect x="12" y="12" width="24" height="24" rx="4" {...ln} />
      {part}
    </>
  ),
  auto_brim: () => (
    <>
      {lines("M9 17 V9 H17 M31 9 H39 V17 M39 31 V39 H31 M17 39 H9 V31", { ...ln, strokeWidth: 2 })}
      {part}
    </>
  ),
};

// A cylinder from the side, and where each layer's wall starts.
const cylinder = (
  <>
    <rect x="12" y="10" width="24" height="30" rx="2" {...body} />
    <ellipse cx="24" cy="10" rx="12" ry="3.5" {...ln} />
  </>
);
const dots = (points: [number, number][], style: object = { fill: "currentColor" }) =>
  points.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" {...style} />);
const column = (x: number) => Array.from({ length: 7 }, (_, i): [number, number] => [x, 15 + i * 4]);

const SEAM: Record<string, () => ReactNode> = {
  aligned: () => (
    <>
      {cylinder}
      {dots(column(27))}
    </>
  ),
  nearest: () => (
    <>
      {cylinder}
      {dots(column(34))}
    </>
  ),
  back: () => (
    <>
      {cylinder}
      {dots(column(24), { fill: "currentColor", opacity: 0.35 })}
    </>
  ),
  random: () => (
    <>
      {cylinder}
      {dots([
        [17, 15],
        [29, 19],
        [21, 23],
        [32, 27],
        [16, 31],
        [26, 35],
      ])}
    </>
  ),
};

// Two walls from the side, outer above inner, and how each closes its loop: square on, or sloped (scarf).
const strips = (
  <>
    <rect x="6" y="11" width="36" height="10" rx="1" {...body} />
    <rect x="6" y="27" width="36" height="10" rx="1" {...body} />
  </>
);
const SCARF: Record<string, () => ReactNode> = {
  none: () => (
    <>
      {strips}
      {lines("M24 11 V21 M24 27 V37", thick)}
    </>
  ),
  external: () => (
    <>
      {strips}
      {lines("M16 21 L32 11 M24 27 V37", thick)}
    </>
  ),
  all: () => (
    <>
      {strips}
      {lines("M16 21 L32 11 M16 37 L32 27", thick)}
    </>
  ),
};

// Nested walls from above, numbered in the order they print.
const label = (x: number, y: number, text: string) => (
  <text x={x} y={y} fontSize="7" fontWeight="700" fill="currentColor" textAnchor="middle" dominantBaseline="central">
    {text}
  </text>
);
const WALLS: Record<string, () => ReactNode> = {
  "inner wall/outer wall": () => (
    <>
      <rect x="6" y="6" width="36" height="36" rx="4" {...thick} />
      <rect x="15" y="15" width="18" height="18" rx="2" {...ln} />
      {label(24, 24, "1")}
      {label(24, 10.5, "2")}
    </>
  ),
  "outer wall/inner wall": () => (
    <>
      <rect x="6" y="6" width="36" height="36" rx="4" {...thick} />
      <rect x="15" y="15" width="18" height="18" rx="2" {...ln} />
      {label(24, 24, "2")}
      {label(24, 10.5, "1")}
    </>
  ),
  "inner-outer-inner wall": () => (
    <>
      <rect x="5" y="5" width="38" height="38" rx="4" {...thick} />
      <rect x="12" y="12" width="24" height="24" rx="3" {...ln} />
      <rect x="18" y="18" width="12" height="12" rx="2" {...ln} />
      {label(24, 24, "1")}
      {label(24, 8.5, "2")}
      {label(24, 15, "3")}
    </>
  ),
};

// A stepped part from the side; the surfaces ironing passes over are drawn in the accent.
const steps = (
  <>
    <rect x="6" y="28" width="36" height="12" {...body} />
    <rect x="6" y="14" width="18" height="14" {...body} />
  </>
);
const IRONING: Record<string, () => ReactNode> = {
  "no ironing": () => steps,
  topmost: () => (
    <>
      {steps}
      {lines("M6 14 H24", thick)}
    </>
  ),
  top: () => (
    <>
      {steps}
      {lines("M6 14 H24 M24 28 H42", thick)}
    </>
  ),
  solid: () => (
    <>
      {steps}
      {lines("M6 14 H24 M24 28 H42 M6 40 H42", thick)}
    </>
  ),
};

const jagged = (x0: number, y0: number, x1: number, y1: number) => {
  const pts: string[] = [];
  const step = 3;
  for (let x = x0; x < x1; x += step) pts.push(`${x},${y0 + ((x / step) % 2 ? -1.2 : 1.2)}`);
  for (let y = y0; y < y1; y += step) pts.push(`${x1 + ((y / step) % 2 ? 1.2 : -1.2)},${y}`);
  for (let x = x1; x > x0; x -= step) pts.push(`${x},${y1 + ((x / step) % 2 ? 1.2 : -1.2)}`);
  for (let y = y1; y > y0; y -= step) pts.push(`${x0 + ((y / step) % 2 ? -1.2 : 1.2)},${y}`);
  return <polygon points={pts.join(" ")} {...thick} strokeWidth={1.6} />;
};
const FUZZY: Record<string, () => ReactNode> = {
  none: () => (
    <>
      <rect x="8" y="8" width="32" height="32" rx="2" {...thick} />
      <rect x="18" y="18" width="12" height="12" rx="1" {...ln} />
    </>
  ),
  external: () => (
    <>
      {jagged(8, 8, 40, 40)}
      <rect x="18" y="18" width="12" height="12" rx="1" {...ln} />
    </>
  ),
  all: () => (
    <>
      {jagged(8, 8, 40, 40)}
      {jagged(18, 18, 30, 30)}
    </>
  ),
};

// A wall that narrows, filled the classic way (fixed-width lines, a gap fill where they don't fit) or by Arachne
// (lines that widen and narrow with it).
const wedge = <path d="M6 10 L42 20 L42 28 L6 38 Z" {...body} />;
const GENERATOR: Record<string, () => ReactNode> = {
  classic: () => (
    <>
      {wedge}
      {lines("M6 14 L42 22 M6 34 L42 26")}
      {lines("M10 22 L14 26 L18 22 L22 26 L26 22", faint)}
    </>
  ),
  arachne: () => (
    <>
      {wedge}
      {lines("M6 15 C20 18, 30 21, 42 22.5 M6 24 C20 24, 30 24, 42 24 M6 33 C20 30, 30 27, 42 25.5")}
    </>
  ),
};

const DRAWINGS: Record<string, Record<string, (clip: string) => ReactNode>> = {
  sparse_infill_pattern: INFILL,
  top_surface_pattern: TOP,
  support_type: SUPPORT,
  brim_type: BRIM,
  seam_position: SEAM,
  seam_slope_type: SCARF,
  wall_sequence: WALLS,
  ironing_type: IRONING,
  fuzzy_skin: FUZZY,
  wall_generator: GENERATOR,
};

/** Whether the setting's choices have pictures. */
export function hasChoicePreviews(setting: string): boolean {
  return Object.hasOwn(DRAWINGS, setting);
}

/** A choice's picture, `size` pixels square; nothing for a choice without one. */
export function ChoicePreview({ setting, value, size = 28 }: { setting: string; value: string; size?: number }) {
  const clip = useId().replace(/:/g, "");
  const draw = Object.hasOwn(DRAWINGS, setting) ? DRAWINGS[setting][value] : undefined;
  if (!draw) return null;
  return (
    <Box
      component="svg"
      viewBox="0 0 48 48"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "block",
        color: "primary.main",
        bgcolor: "action.hover",
        borderRadius: 0.75,
      }}
    >
      {draw(`pv-${clip}`)}
    </Box>
  );
}
