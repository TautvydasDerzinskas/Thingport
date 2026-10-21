import { useState } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { keyframes } from "@mui/material/styles";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import type { PrintQuality } from "../../../api/prints";
import { QUALITY_SEVERITY_COLOR, QUALITY_SEVERITY_ICON, worstSeverity } from "../../../components/QualitySeverityChip";
import QualityReportDialog from "./QualityReportDialog";

const pop = keyframes`
  0% { transform: scale(0.3); opacity: 0; }
  65% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); }
`;

/** Beside the 3D preview button: a tick for a model that passed, otherwise its worst problem's icon and colour. Opens
 * the report. */
export default function QualityBadge({ quality, isAdmin }: { quality: PrintQuality | null; isAdmin?: boolean }) {
  const { t } = useTranslation("models");
  const [open, setOpen] = useState(false);
  if (!quality || (quality.status !== "good" && quality.status !== "issues")) return null;

  const good = quality.status === "good";
  const worst = worstSeverity(quality);
  const label = good ? t("detail.quality.badgeGood") : t("detail.quality.badgeIssues");
  const Icon = good ? VerifiedRoundedIcon : QUALITY_SEVERITY_ICON[worst];

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          onClick={() => setOpen(true)}
          sx={{
            width: 32,
            height: 32,
            bgcolor: "rgba(0, 0, 0, 0.65)",
            color: good ? "success.light" : `${QUALITY_SEVERITY_COLOR[worst]}.light`,
            "&:hover": { bgcolor: "rgba(0, 0, 0, 0.8)" },
            animation: `${pop} 320ms ease-out both`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          <Icon fontSize="small" />
        </IconButton>
      </Tooltip>
      <QualityReportDialog open={open} quality={quality} isAdmin={isAdmin} onClose={() => setOpen(false)} />
    </>
  );
}
