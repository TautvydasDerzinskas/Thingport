import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import { alpha } from "@mui/material/styles";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";

type Props = {
  src?: string;
  name: string;
  size: number;
  /** What clicking does, for its tooltip and screen readers: "Change avatar". */
  label: string;
  onClick: () => void;
};

/** The user's own avatar, which opens the avatar popup: a camera over it on hover or focus says so. */
export default function EditableAvatar({ src, name, size, label, onClick }: Props) {
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={label}
        onClick={onClick}
        sx={(theme) => ({
          position: "relative",
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          "&:hover .avatar-change, &.Mui-focusVisible .avatar-change": { opacity: 1 },
          "&.Mui-focusVisible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        })}
      >
        <Avatar src={src} alt="" sx={{ width: size, height: size, fontSize: Math.round(size * 0.4), fontWeight: 700 }}>
          {(name.trim() || "?").slice(0, 1).toUpperCase()}
        </Avatar>
        <Box
          className="avatar-change"
          aria-hidden
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: alpha(theme.palette.common.black, 0.45),
            color: theme.palette.common.white,
            opacity: 0,
            transition: "opacity 150ms ease-out",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          })}
        >
          <PhotoCameraOutlinedIcon sx={{ fontSize: Math.max(18, Math.round(size * 0.28)) }} />
        </Box>
      </ButtonBase>
    </Tooltip>
  );
}
