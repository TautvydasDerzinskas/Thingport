import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import type { AdaptPlan } from "../../adapter/plan.generated";

/** The "Open adapted in <slicer>" icon; hovering it explains what the copy made for that slicer, and printer, keeps
 *  and changes. */
export default function AdaptedInfoIcon({ slicerLabel, plan }: { slicerLabel: string; plan: AdaptPlan }) {
  const { t } = useTranslation(["models"]);
  return (
    <Tooltip
      title={t(`models:detail.adaptedInfo.${plan.output === "bambu" && plan.printer ? "bambuPrinter" : plan.output}`, {
        slicer: slicerLabel,
      })}
      arrow
      describeChild
    >
      <LightbulbIcon fontSize="small" sx={{ color: "inherit" }} />
    </Tooltip>
  );
}
