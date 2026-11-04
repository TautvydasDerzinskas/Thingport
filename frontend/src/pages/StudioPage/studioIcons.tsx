import { useId } from "react";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import type { FeatureType } from "../../studio/document";

// Line drawings of Studio's solids and booleans, in the outlined style of the MUI icons beside them.

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

export function BoxIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7zM4.5 7.7 12 12l7.5-4.3M12 12v8.5" />
    </SvgIcon>
  );
}

export function CylinderIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <ellipse {...line} cx="12" cy="6.2" rx="6.5" ry="2.5" />
      <path {...line} d="M5.5 6.2v11.6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V6.2" />
    </SvgIcon>
  );
}

export function ConeIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M5.5 17.5 12 3.5l6.5 14" />
      <ellipse {...line} cx="12" cy="17.5" rx="6.5" ry="2.5" />
    </SvgIcon>
  );
}

export function SphereIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <circle {...line} cx="12" cy="12" r="8" />
      <path {...line} d="M4 12c0 1.6 3.6 3 8 3s8-1.4 8-3" />
    </SvgIcon>
  );
}

export function TorusIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <ellipse {...line} cx="12" cy="12" rx="9" ry="5.5" />
      <path {...line} d="M8.2 11.2c1.9 1.6 5.7 1.6 7.6 0M9.3 12.1c1.7-1 3.7-1 5.4 0" />
    </SvgIcon>
  );
}

/** A model brought in from the library: a shape made of triangles. */
export function MeshIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M12 3.5 20.5 19h-17zM12 3.5 8.2 19M12 3.5 15.8 19M6.2 14h11.6" />
    </SvgIcon>
  );
}

export function RevolveIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M12 3v18" strokeDasharray="1.6 2" />
      <path
        {...line}
        d="M18.5 9.5C17.8 7.5 15.2 6 12 6S6.2 7.5 5.5 9.5M5.5 14.5C6.2 16.5 8.8 18 12 18c2 0 3.8-.6 5-1.5"
      />
      <path {...line} d="m15.8 15.2 1.6 1.4-1.4 1.6" />
    </SvgIcon>
  );
}

export function HoleIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <rect {...line} x="4" y="4" width="16" height="16" rx="2" />
      <circle {...line} cx="12" cy="12" r="3.5" />
    </SvgIcon>
  );
}

export function PressPullIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4 20h16M6 20v-6h12v6" />
      <path {...line} d="M12 11V3M9 6l3-3 3 3" />
    </SvgIcon>
  );
}

export function FilletIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M5 20v-8a7 7 0 0 1 7-7h8" />
      <path {...line} d="M5 12V5h7" strokeDasharray="1.6 2" />
    </SvgIcon>
  );
}

export function ChamferIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M5 20v-9l6-6h9" />
      <path {...line} d="M5 11V5h6" strokeDasharray="1.6 2" />
    </SvgIcon>
  );
}

export function ShellIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4 5h16v14H4zM8 5v10h8V5" />
    </SvgIcon>
  );
}

export function SplitIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4 4h16v6H4zM4 14h16v6H4z" />
      <path {...line} d="M2 12h20" strokeDasharray="1.6 2" />
    </SvgIcon>
  );
}

/** Two pieces of a body drawn apart, where they were dashed between them. */
export function SeparateIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M3 12.5h7.5V20H3zM13.5 4H21v7.5h-7.5z" />
      <path {...line} d="M10.5 12.5 13.5 11.5M10.5 15.5l3-4" strokeDasharray="1.4 1.8" />
    </SvgIcon>
  );
}

/** One of a body's separated parts: a piece, its sibling dashed beside it. */
export function PartIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M3.5 9h10v11h-10z" />
      <path {...line} d="M16.5 4h4v8h-4z" strokeDasharray="1.4 1.8" />
    </SvgIcon>
  );
}

export function ExtrudeIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4 16.5 12 20l8-3.5-8-3.5zM12 3v8.5M8.8 6.2 12 3l3.2 3.2" />
    </SvgIcon>
  );
}

export function SketchIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4 20h7M5 15.5l9.6-9.6a2 2 0 0 1 2.9 2.9L7.9 18.4 4 19.6z" strokeDasharray="0" />
      <path {...line} d="M15 20h5M20 15v5" strokeDasharray="1.6 2" />
    </SvgIcon>
  );
}

/** Two discs, shaded as the boolean leaves them. */
function Venn({ keep, ...props }: SvgIconProps & { keep: "union" | "subtract" | "intersect" }) {
  const id = useId();
  const a = <circle cx="9" cy="12" r="6" />;
  const b = <circle cx="15" cy="12" r="6" />;
  return (
    <SvgIcon {...props}>
      <defs>
        <clipPath id={`${id}-b`}>{b}</clipPath>
        <mask id={`${id}-cut`}>
          <rect width="24" height="24" fill="white" />
          <circle cx="15" cy="12" r="6" fill="black" />
        </mask>
      </defs>
      {keep === "union" && (
        <g fill="currentColor" opacity={0.35}>
          {a}
          {b}
        </g>
      )}
      {keep === "subtract" && (
        <circle cx="9" cy="12" r="6" fill="currentColor" opacity={0.35} mask={`url(#${id}-cut)`} />
      )}
      {keep === "intersect" && (
        <circle cx="9" cy="12" r="6" fill="currentColor" opacity={0.45} clipPath={`url(#${id}-b)`} />
      )}
      <circle {...line} cx="9" cy="12" r="6" />
      <circle {...line} cx="15" cy="12" r="6" strokeDasharray={keep === "subtract" ? "1.6 2" : undefined} />
    </SvgIcon>
  );
}

export const UnionIcon = (props: SvgIconProps) => <Venn keep="union" {...props} />;
export const SubtractIcon = (props: SvgIconProps) => <Venn keep="subtract" {...props} />;
export const IntersectIcon = (props: SvgIconProps) => <Venn keep="intersect" {...props} />;

export function PatternIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <rect {...line} x="3" y="9" width="5" height="6" rx="1" />
      <rect {...line} x="9.5" y="9" width="5" height="6" rx="1" opacity={0.75} />
      <rect {...line} x="16" y="9" width="5" height="6" rx="1" opacity={0.5} />
    </SvgIcon>
  );
}

export function CircularPatternIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <circle {...line} cx="12" cy="12" r="7" strokeDasharray="1.6 2.4" opacity={0.6} />
      {[0, 72, 144, 216, 288].map((degrees) => (
        <circle
          key={degrees}
          cx={12 + 7 * Math.sin((degrees * Math.PI) / 180)}
          cy={12 - 7 * Math.cos((degrees * Math.PI) / 180)}
          r="2"
          fill="currentColor"
        />
      ))}
    </SvgIcon>
  );
}

export function MirrorIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M12 3v18" strokeDasharray="1.6 2" />
      <path {...line} d="M9.5 6.5 4 17.5h5.5z" />
      <path {...line} d="M14.5 6.5 20 17.5h-5.5z" opacity={0.6} />
    </SvgIcon>
  );
}

export function HullIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <circle {...line} cx="7" cy="14" r="3" opacity={0.6} />
      <circle {...line} cx="17" cy="9" r="2" opacity={0.6} />
      <path {...line} d="M5.7 11.3 16.1 7.2a2 2 0 0 1 1.8 3.6L8.4 16.8a3 3 0 0 1-2.7-5.5z" />
    </SvgIcon>
  );
}

export function LayFlatIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M3 20.5h18" />
      <path {...line} d="M7 17.5h10v-4H7z" />
      <path {...line} d="M15.5 3.5 19 7l-3.5 3.5M19 7h-6a3 3 0 0 0-3 3v1" opacity={0.7} />
    </SvgIcon>
  );
}

/** Where align puts a body (filled) against the one it lines up with (outlined), along x; turned, along z. */
const ALIGN_AT = { none: null, before: 1, start: 7, center: 9, end: 11, after: 17 } as const;

export function AlignModeIcon({
  mode,
  vertical,
  ...props
}: SvgIconProps & { mode: keyof typeof ALIGN_AT; vertical?: boolean }) {
  const at = ALIGN_AT[mode];
  return (
    // Turned a quarter anticlockwise, before is below and after is on top.
    <SvgIcon {...props} sx={{ ...props.sx, transform: vertical ? "rotate(-90deg)" : undefined }}>
      <rect {...line} x="7" y="5" width="10" height="14" rx="1" strokeDasharray={at === null ? "2 2" : undefined} />
      {at !== null && <rect x={at} y="9" width="6" height="6" rx="0.75" fill="currentColor" />}
    </SvgIcon>
  );
}

/** A sketch's Line tool: a straight piece between two points. */
export function LineToolIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M5.5 18.5 18.5 5.5" />
      <circle cx="5.5" cy="18.5" r="1.9" fill="currentColor" />
      <circle cx="18.5" cy="5.5" r="1.9" fill="currentColor" />
    </SvgIcon>
  );
}

/** A sketch's Arc tool: an arc between its ends, through a third point. */
export function ArcToolIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4.5 17a7.5 7.5 0 0 1 15 0" />
      <circle cx="4.5" cy="17" r="1.9" fill="currentColor" />
      <circle cx="19.5" cy="17" r="1.9" fill="currentColor" />
      <circle cx="12" cy="9.5" r="1.4" fill="currentColor" />
    </SvgIcon>
  );
}

export function ThreadIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M8.5 4h7M9 4v16h6V4" />
      <path {...line} d="M7.5 7.5 16.5 9M7.5 11 16.5 12.5M7.5 14.5 16.5 16M7.5 18 16.5 19.5" opacity={0.7} />
    </SvgIcon>
  );
}

export function LoftIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <ellipse {...line} cx="12" cy="18" rx="7" ry="2.2" />
      <path {...line} d="M8.5 4.5h7l-1 2.5h-5z" />
      <path {...line} d="M5 18 8.8 6M19 18 15.2 6" />
    </SvgIcon>
  );
}

export function SweepIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path {...line} d="M4 19c0-8 6-14 14-14" strokeDasharray="1.6 2" opacity={0.6} />
      <path {...line} d="M3 15.5c2.5-7.5 8-12 15.5-12.5M8 20c1-5.5 5-10 11-10.5" />
      <ellipse {...line} cx="5.5" cy="17.8" rx="2.6" ry="1.4" transform="rotate(-20 5.5 17.8)" />
    </SvgIcon>
  );
}

export function FeatureIcon({ type, ...props }: SvgIconProps & { type: FeatureType }) {
  if (type === "box") return <BoxIcon {...props} />;
  if (type === "cylinder") return <CylinderIcon {...props} />;
  if (type === "cone") return <ConeIcon {...props} />;
  if (type === "sphere") return <SphereIcon {...props} />;
  if (type === "torus") return <TorusIcon {...props} />;
  if (type === "extrude") return <ExtrudeIcon {...props} />;
  if (type === "mesh") return <MeshIcon {...props} />;
  if (type === "revolve") return <RevolveIcon {...props} />;
  if (type === "press_pull") return <PressPullIcon {...props} />;
  if (type === "fillet") return <FilletIcon {...props} />;
  if (type === "chamfer") return <ChamferIcon {...props} />;
  if (type === "hole") return <HoleIcon {...props} />;
  if (type === "shell") return <ShellIcon {...props} />;
  if (type === "split") return <SplitIcon {...props} />;
  if (type === "part") return <PartIcon {...props} />;
  if (type === "sketch") return <SketchIcon {...props} />;
  if (type === "pattern") return <PatternIcon {...props} />;
  if (type === "hull") return <HullIcon {...props} />;
  if (type === "thread") return <ThreadIcon {...props} />;
  if (type === "loft") return <LoftIcon {...props} />;
  if (type === "sweep") return <SweepIcon {...props} />;
  return <UnionIcon {...props} />;
}
