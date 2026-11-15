import React from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import {
  materialOf,
  plateOf,
  type AchievementDef,
  type Cut,
  type Glyph,
  type Material,
} from "../../constants/achievements";
import { GuestFigure, glyphArt } from "./glyphs";

// An achievement's badge: a sticker in the mascot's style. Flat colour in an ink outline with a white die-cut edge,
// its shape saying what kind of badge it is and its colour the tier, a tag with the tier's number. Diamond and up
// sparkle and holographic shifts its colours; a light crosses each now and then (bronze only on hover), and it tilts
// on hover.
//
// SVG, so dark mode's square corners leave the shape alone; the colours are the illustration's own, the same in both
// themes, as a sticker is. Only transform and opacity move, and nothing does with reduced motion.

type Palette = { main: string; shade: string };
const INK = "#1f1f1f";
const PALETTES: Record<Material, Palette> = {
  bronze: { main: "#e08a4c", shade: "#c26b30" },
  silver: { main: "#c3ccd8", shade: "#9fabba" },
  gold: { main: "#ffcb30", shade: "#f0a800" },
  platinum: { main: "#cdbdff", shade: "#a993f5" },
  diamond: { main: "#4fdcf7", shade: "#1fb5dc" },
  holo: { main: "#ffffff", shade: "#e0e0e0" },
  secret: { main: "#00b800", shade: "#009400" },
};
const SPARKS: Partial<Record<Material, number>> = { platinum: 2, diamond: 3, holo: 5, secret: 3 };
const SPARK_SPOTS: [number, number][] = [
  [83, 17],
  [15, 27],
  [88, 66],
  [20, 80],
  [54, 7],
];
const SPARK = "M0 -7Q1.3 -1.3 7 0 1.3 1.3 0 7-1.3 1.3-7 0-1.3-1.3 0-7Z";
const HOLO = ["#ff6ec7", "#ffd36e", "#7dffb0", "#6ee7ff", "#9d8cff", "#ff6ec7", "#ffd36e", "#7dffb0", "#6ee7ff"].map(
  (color, i, all) => ({ color, offset: i / (all.length - 1) }),
);

type Pt = [number, number];
const f = (n: number) => Math.round(n * 100) / 100;

function roundedPolygon(points: Pt[], t: number): string {
  return (
    points
      .map((v, i) => {
        const p = points[(i - 1 + points.length) % points.length];
        const q = points[(i + 1) % points.length];
        const a = [v[0] + (p[0] - v[0]) * t, v[1] + (p[1] - v[1]) * t];
        const b = [v[0] + (q[0] - v[0]) * t, v[1] + (q[1] - v[1]) * t];
        return `${i ? "L" : "M"}${f(a[0])} ${f(a[1])}Q${f(v[0])} ${f(v[1])} ${f(b[0])} ${f(b[1])}`;
      })
      .join("") + "Z"
  );
}

const around = (count: number, radius: (i: number) => number, offset = 0): Pt[] =>
  Array.from({ length: count }, (_, i) => {
    const a = ((-90 + (360 / count) * i + offset) * Math.PI) / 180;
    return [50 + radius(i) * Math.cos(a), 48 + radius(i) * Math.sin(a)];
  });

const CUTS: Record<Exclude<Cut, "mascot">, string> = {
  shield: "M50 5C62 12 74 14 86 14V44C86 68 70 84 50 94 30 84 14 68 14 44V14C26 14 38 12 50 5Z",
  squircle: "M50 7C83 7 91 15 91 48 91 81 83 89 50 89 17 89 9 81 9 48 9 15 17 7 50 7Z",
  cog: roundedPolygon(
    around(32, (i) => (Math.floor(i / 2) % 2 === 0 ? 44 : 37), 5.6),
    0.2,
  ),
  hex: roundedPolygon(
    around(6, () => 45),
    0.18,
  ),
  rosette: roundedPolygon(
    around(28, (i) => (i % 2 === 0 ? 45 : 39.5)),
    0.45,
  ),
};

const shine = keyframes`
  0% { transform: translateX(-60px); }
  18%, 100% { transform: translateX(170px); }
`;
const shineOnce = keyframes`
  from { transform: translateX(-60px); }
  to { transform: translateX(170px); }
`;
const spark = keyframes`
  0%, 100% { opacity: 0; transform: scale(0.2) rotate(0deg); }
  45% { opacity: 1; transform: scale(1) rotate(45deg); }
  70% { opacity: 0; transform: scale(0.3) rotate(90deg); }
`;
const holo = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(195px); }
`;

const badgeSx = {
  display: "block",
  overflow: "visible",
  flexShrink: 0,
  transition: "transform 200ms ease",
  "& .tpb-shine": {
    transform: "translateX(-60px)",
    animation: `${shine} 5.5s ease-in-out var(--tpb-delay, 0s) infinite`,
  },
  "& .tpb-shine-hover": { animation: "none" },
  "& .tpb-spark": {
    opacity: 0,
    transformBox: "fill-box",
    transformOrigin: "center",
    animation: `${spark} 2.4s ease-in-out infinite`,
  },
  "& .tpb-holo": { animation: `${holo} 6s ease-in-out infinite alternate` },
  "& .tpb-tilt": {
    transformBox: "view-box",
    transformOrigin: "50px 50px",
    transition: "transform 220ms cubic-bezier(.3,1.6,.5,1)",
  },
  "&:hover .tpb-tilt, *:focus-visible > & .tpb-tilt": { transform: "rotate(-6deg) scale(1.04)" },
  "&:hover .tpb-shine, &:hover .tpb-shine-hover": { animation: `${shineOnce} 900ms ease-out` },
  "&.tpb-expired": { filter: "grayscale(1)", opacity: 0.5 },
  "&.tpb-expired *": { animation: "none !important" },
  "@media (prefers-reduced-motion: reduce)": {
    transition: "none",
    "& *": { animation: "none !important", transition: "none !important" },
    "& .tpb-spark": { opacity: 0 },
  },
} as const;

function plateWidth(text: string): number {
  return text.length <= 1 ? 17 : text.length === 2 ? 22 : 27;
}

function Sparkles({ material, color }: { material: Material; color: string }) {
  return (
    <g pointerEvents="none">
      {SPARK_SPOTS.slice(0, SPARKS[material] ?? 0).map(([x, y], i) => (
        <g key={`${x},${y}`} transform={`translate(${x} ${y}) scale(${i % 2 ? 0.7 : 1})`}>
          <path className="tpb-spark" d={SPARK} fill={color} style={{ animationDelay: `${(i * 0.73) % 2.2}s` }} />
        </g>
      ))}
    </g>
  );
}

function Mascot({ id }: { id: string }) {
  return (
    <g className="tpb-tilt">
      <defs>
        <filter id={`${id}drop`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#000" floodOpacity="0.28" />
        </filter>
      </defs>
      <g transform="translate(4 2) scale(0.92)" filter={`url(#${id}drop)`}>
        {/* The die-cut: the figure again, fat and white, under it. */}
        <g stroke="#fff" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" fill="#fff">
          <path d="M40 70V96M60 70V96M22 46 11 66M78 46 89 34" />
          <path d="M45.4 11.3Q50 8.6 54.6 11.3L72.5 21.7Q77.2 24.3 77.2 29.7V50.4Q77.2 55.7 72.5 58.3L54.6 68.7Q50 71.4 45.4 68.7L27.5 58.3Q22.8 55.7 22.8 50.4V29.7Q22.8 24.3 27.5 21.7Z" />
          <rect x="15" y="20" width="70" height="28" rx="12" />
        </g>
        <GuestFigure />
      </g>
      <Sparkles material="secret" color="#ffd84d" />
    </g>
  );
}

function Sticker({
  id,
  cut,
  material,
  glyph,
  plate,
}: {
  id: string;
  cut: Exclude<Cut, "mascot">;
  material: Material;
  glyph: Glyph;
  plate?: string;
}) {
  const palette = PALETTES[material];
  const d = CUTS[cut];
  const glyphSize = 36;
  const glyphY = cut === "shield" ? 44 : 46;
  return (
    <g className="tpb-tilt">
      <defs>
        <filter id={`${id}drop`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#000" floodOpacity="0.28" />
        </filter>
        <clipPath id={`${id}cut`}>
          <path d={d} />
        </clipPath>
        <linearGradient id={`${id}shine`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {material === "holo" && (
          <linearGradient id={`${id}holo`} x1="0" x2="1" y1="0" y2="0.35">
            {HOLO.map(({ color, offset }) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        )}
      </defs>
      <path d={d} fill="#fff" stroke="#fff" strokeWidth="11" strokeLinejoin="round" filter={`url(#${id}drop)`} />
      <path d={d} fill={palette.main} />
      <g clipPath={`url(#${id}cut)`}>
        {/* Flat two-tone: the lower right a shade darker. */}
        <path d="M100 30 100 100 20 100Z" fill={palette.shade} />
        {material === "holo" && (
          <rect className="tpb-holo" x="-200" y="-10" width="400" height="120" fill={`url(#${id}holo)`} opacity="0.9" />
        )}
      </g>
      <path d={d} fill="none" stroke={INK} strokeWidth="4.2" strokeLinejoin="round" />
      <g color={INK} transform={`translate(${50 - glyphSize / 2} ${glyphY - glyphSize / 2}) scale(${glyphSize / 40})`}>
        {glyphArt(glyph)}
      </g>
      <g clipPath={`url(#${id}cut)`} pointerEvents="none">
        <g transform="skewX(-22)">
          <rect
            className={material === "bronze" ? "tpb-shine tpb-shine-hover" : "tpb-shine"}
            x="-40"
            y="-10"
            width="34"
            height="130"
            fill={`url(#${id}shine)`}
          />
        </g>
      </g>
      {plate && (
        <g transform="rotate(-8 76 80)">
          <rect
            x={75 - plateWidth(plate) / 2}
            y="72"
            width={plateWidth(plate) + 2}
            height="16"
            rx="4"
            fill="#fff"
            stroke={INK}
            strokeWidth="2.6"
          />
          <text
            x="76"
            y="84.2"
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="800"
            fill={INK}
            fontFamily='"Open Sans", sans-serif'
          >
            {plate}
          </text>
        </g>
      )}
      <Sparkles material={material} color={material === "holo" ? "#ffd84d" : "#fff"} />
    </g>
  );
}

type Props = {
  def: AchievementDef;
  tier: number;
  /** Width and height, in px. */
  size?: number;
  /** A badge that lapsed (Regular): grey and still. */
  expired?: boolean;
  /** Read out instead of nothing: for a badge that stands alone, not one beside its name. */
  label?: string;
};

export default function AchievementBadge({ def, tier, size = 48, expired, label }: Props) {
  const id = `b${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const material = materialOf(def, tier);
  // Too small to read under 36px: the tooltip and the stat say it there.
  const plate = size >= 36 ? plateOf(def, tier) : undefined;
  // Each badge's light crosses at its own moment, so a row of them doesn't flash at once.
  const delay = ([...`${def.id}${tier}`].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 9973, 7) % 50) / 10;
  return (
    <Box
      component="svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={expired ? "tpb-expired" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ "--tpb-delay": `${delay}s` } as React.CSSProperties}
      sx={badgeSx}
    >
      {def.cut === "mascot" ? (
        <Mascot id={id} />
      ) : (
        <Sticker id={id} cut={def.cut} material={material} glyph={def.glyph} plate={plate} />
      )}
    </Box>
  );
}
