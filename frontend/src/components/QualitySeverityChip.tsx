import { useTranslation } from "react-i18next";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import type { PrintQuality, QualitySeverity } from "../api/prints";

export const QUALITY_SEVERITY_COLOR = { critical: "error", major: "warning", minor: "info" } as const;
export const QUALITY_SEVERITY_ICON = {
  critical: ErrorOutlineRoundedIcon,
  major: WarningAmberRoundedIcon,
  minor: InfoOutlinedIcon,
} as const;
const SEVERITIES: QualitySeverity[] = ["critical", "major", "minor"];

/** The most serious problem in any of the model's files. */
export function worstSeverity(quality: PrintQuality): QualitySeverity {
  return (
    SEVERITIES.find((severity) =>
      quality.files.some((file) => file.issues.some((issue) => issue.severity === severity)),
    ) ?? "minor"
  );
}

/** How serious a print problem is, with what that level means on hover or focus. */
export default function QualitySeverityChip({ severity }: { severity: QualitySeverity }) {
  const { t } = useTranslation("models");
  return (
    <Tooltip title={t(`detail.quality.severity.${severity}Hint`)}>
      <Chip
        size="small"
        variant="outlined"
        color={QUALITY_SEVERITY_COLOR[severity]}
        label={t(`detail.quality.severity.${severity}`)}
        // Focusable, so the hint reaches keyboard users too.
        tabIndex={0}
        sx={{ height: 20, fontSize: 11, fontWeight: 600, flexShrink: 0, "& .MuiChip-label": { px: 0.75 } }}
      />
    </Tooltip>
  );
}
