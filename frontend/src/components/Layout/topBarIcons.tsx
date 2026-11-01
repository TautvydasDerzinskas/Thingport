import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import type { Theme } from "@mui/material/styles";

/** The top bar's round outlined buttons, all one size, so the row lines up with the avatar. */
export const topBarButtonSx = {
  width: 32,
  height: 32,
  flexShrink: 0,
  border: 1,
  borderColor: "divider",
  bgcolor: "background.paper",
  color: "action.active",
  "&:hover": { bgcolor: "action.hover" },
};

// The accent parts follow the accent the user picked; the rest is the icon's own colour.
const twoToneSx = (theme: Theme) => ({
  "& .detail": { fill: theme.palette.primary.main },
  "& .tint": { fill: theme.palette.primary.main, opacity: 0.22 },
  "& .line": { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" },
  "& .badge": { fill: theme.palette.primary.main, stroke: theme.palette.background.paper, strokeWidth: 1.5 },
  "& .mark": { fill: theme.palette.primary.contrastText },
});

function TwoToneIcon({ sx, children, ...props }: SvgIconProps) {
  return (
    <SvgIcon fontSize="small" fillRule="evenodd" sx={[twoToneSx, ...(Array.isArray(sx) ? sx : [sx])]} {...props}>
      {children}
    </SvgIcon>
  );
}

export function SearchTwoToneIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path className="tint" d="M10 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
      <path d="M10 3a7 7 0 1 0 4.3 12.5l5.3 5.3 1.4-1.4-5.3-5.3A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" />
      <path className="detail" d="M10 6.3A3.7 3.7 0 0 0 6.3 10h1.6A2.1 2.1 0 0 1 10 7.9V6.3z" />
    </TwoToneIcon>
  );
}

/** A 3D model with a plus badge. */
export function AddModelIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path className="line" d="M11 2.5 3 7v9.5l8 4.5 8-4.5V7l-8-4.5zM3.2 7.1 11 11.6l7.8-4.5M11 11.6V21" />
      <path className="badge" d="M18 12.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" />
      <path className="mark" d="M17.25 15h1.5v2.25H21v1.5h-2.25V21h-1.5v-2.25H15v-1.5h2.25z" />
    </TwoToneIcon>
  );
}

export function NotificationsTwoToneIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path d="M18 16v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
      <path className="detail" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2z" />
    </TwoToneIcon>
  );
}

/** A tray with an arrow dropping into it. */
export function ImportQueueIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path d="M4 14h3.5l1.5 3h6l1.5-3H20v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5z" />
      <path className="detail" d="M11 3h2v6.2l2.3-2.3 1.4 1.4L12 13 7.3 8.3l1.4-1.4L11 9.2V3z" />
    </TwoToneIcon>
  );
}

export function ImportLinkIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
      <path className="detail" d="M8 13h8v-2H8z" />
    </TwoToneIcon>
  );
}

export function UploadFilesIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
      <path className="detail" d="M12 11l-4 4h3v4h2v-4h3z" />
    </TwoToneIcon>
  );
}

export function UploadFolderIcon(props: SvgIconProps) {
  return (
    <TwoToneIcon {...props}>
      <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16v10z" />
      <path className="detail" d="M12 9.5 8.5 13H11v3.5h2V13h2.5z" />
    </TwoToneIcon>
  );
}
