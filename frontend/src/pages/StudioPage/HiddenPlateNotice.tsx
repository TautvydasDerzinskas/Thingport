import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";

/** Over the bed while the plate in view is hidden: nothing of it is drawn, as with a hidden body. */
export default function HiddenPlateNotice({
  name,
  kind,
  onShow,
}: {
  name: string;
  kind: "plates" | "profiles";
  onShow: () => void;
}) {
  const { t } = useTranslation("app");
  return (
    // The view underneath still turns and pans around the card.
    <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 2, pointerEvents: "none" }}>
      <Paper
        elevation={4}
        sx={{
          pointerEvents: "auto",
          px: 2.5,
          py: 2,
          maxWidth: 300,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.5,
          textAlign: "center",
          "@keyframes hiddenPlateIn": {
            from: { opacity: 0, transform: "translateY(6px) scale(0.98)" },
            to: { opacity: 1, transform: "none" },
          },
          animation: "hiddenPlateIn 200ms ease-out",
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        <VisibilityOffOutlinedIcon sx={{ fontSize: 28, color: "text.secondary" }} />
        <Typography variant="subtitle2" sx={{ wordBreak: "break-word" }}>
          {t(`studio.${kind}.hiddenTitle`, { name })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t(`studio.${kind}.hiddenHint`)}
        </Typography>
        <Button size="small" onClick={onShow} sx={{ mt: 0.5 }}>
          {t(`studio.${kind}.show`)}
        </Button>
      </Paper>
    </Box>
  );
}
