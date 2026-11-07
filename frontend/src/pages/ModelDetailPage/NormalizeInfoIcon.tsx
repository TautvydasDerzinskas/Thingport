import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import LightbulbIcon from "@mui/icons-material/Lightbulb";

/** The "Open normalized in <slicer>" icon; hovering it explains what normalizing keeps and changes. */
export default function NormalizeInfoIcon({ slicerLabel, orca = false }: { slicerLabel: string; orca?: boolean }) {
  const { t } = useTranslation(["models"]);
  // The Orca-fork copy is built for the U1 and keeps the filament; the flat one explains the usual trade-offs.
  const title = orca
    ? t("models:detail.normalizedInfoOrca")
    : t("models:detail.normalizedInfo", { slicer: slicerLabel });
  return (
    <Tooltip title={title} arrow describeChild>
      <LightbulbIcon fontSize="small" sx={{ color: "inherit" }} />
    </Tooltip>
  );
}
