import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import type { AdaptPlan } from "../../adapter/plan.generated";

function infoKey(plan: AdaptPlan): string {
  if (plan.output !== "bambu") return plan.from === "plain" ? `${plan.output}Plain` : plan.output;
  if (plan.from === "prusa") return plan.printer ? "fromPrusaPrinter" : "fromPrusa";
  return plan.printer ? "bambuPrinter" : "bambu";
}

/** The "Open adapted in <slicer>" icon; hovering it explains what the copy made for that slicer, and printer, keeps
 *  and changes. */
export default function AdaptedInfoIcon({ slicerLabel, plan }: { slicerLabel: string; plan: AdaptPlan }) {
  const { t } = useTranslation(["models"]);
  return (
    <Tooltip title={t(`models:detail.adaptedInfo.${infoKey(plan)}`, { slicer: slicerLabel })} arrow describeChild>
      <LightbulbIcon fontSize="small" sx={{ color: "inherit" }} />
    </Tooltip>
  );
}
