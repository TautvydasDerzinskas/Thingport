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

export function FeatureIcon({ type, ...props }: SvgIconProps & { type: FeatureType }) {
  if (type === "box") return <BoxIcon {...props} />;
  if (type === "cylinder") return <CylinderIcon {...props} />;
  if (type === "cone") return <ConeIcon {...props} />;
  if (type === "sphere") return <SphereIcon {...props} />;
  if (type === "torus") return <TorusIcon {...props} />;
  if (type === "extrude") return <ExtrudeIcon {...props} />;
  if (type === "sketch") return <SketchIcon {...props} />;
  return <UnionIcon {...props} />;
}
