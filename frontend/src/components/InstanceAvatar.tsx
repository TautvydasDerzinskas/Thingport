import Avatar from "@mui/material/Avatar";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";

// From the theme, picked by the address so an instance keeps its colour.
const AVATAR_COLORS = ["primary.dark", "info.dark", "secondary.main", "warning.dark", "success.dark", "error.dark"];

/** A connected instance: its initials on a colour of its own, the same wherever it shows. */
export default function InstanceAvatar({ origin, name, size = 36 }: { origin: string; name: string; size?: number }) {
  let hash = 0;
  for (const char of origin) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  // From words that start with a letter: an address like 192.168.1.30:8000 gets the icon, not "11".
  const initials = name
    .replace(/^https?:\/\//, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return (
    <Avatar
      variant="rounded"
      aria-hidden
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        fontWeight: 700,
        bgcolor: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length],
        color: "common.white",
      }}
    >
      {initials || <HubOutlinedIcon sx={{ fontSize: size * 0.55 }} />}
    </Avatar>
  );
}
