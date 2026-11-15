import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/** A 3D printer: frame, gantry and bed, drawn in outline like the outlined icons it sits beside. */
export default function PrinterIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path
        d="M5 3.5h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM4 8h16M10 8v3.5h4V8M7 17.5h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}
