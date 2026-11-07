import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import { statusTint, type StatusTone } from "../theme";

/** A small status chip in a tone's soft colours. */
export default function ToneChip({
  tone,
  label,
  icon,
}: {
  tone: StatusTone | "neutral";
  label: string;
  icon?: React.ReactElement;
}) {
  const theme = useTheme();
  const tint = tone === "neutral" ? null : statusTint(theme, tone);
  return (
    <Chip
      size="small"
      icon={icon}
      label={label}
      variant={tint ? "filled" : "outlined"}
      sx={{
        height: 22,
        borderRadius: "6px",
        fontSize: "0.72rem",
        ...(tint ? { bgcolor: tint.background, color: tint.text } : { color: "text.secondary" }),
        "& .MuiChip-label": { px: 0.75 },
        "& .MuiChip-icon": { fontSize: 14, ml: 0.75, mr: -0.25, color: "inherit" },
      }}
    />
  );
}
