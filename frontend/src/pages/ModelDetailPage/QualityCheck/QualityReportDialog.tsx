import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import type { FileQuality, PrintQuality, QualityIssue } from "../../../api/prints";
import { QUALITY_CHECK_OF_ISSUE } from "../../../api/settings";
import QualitySeverityChip from "../../../components/QualitySeverityChip";
import QualityCheckTile from "../../../components/QualityCheckTile";

type Props = {
  open: boolean;
  quality: PrintQuality;
  /** Offers the way to the quality check settings. */
  isAdmin?: boolean;
  onClose: () => void;
};

function IssueRow({ issue }: { issue: QualityIssue }) {
  const { t } = useTranslation("models");
  const count = issue.count ?? 1;
  return (
    <Stack direction="row" spacing={2} alignItems="center" component="li">
      <QualityCheckTile check={QUALITY_CHECK_OF_ISSUE[issue.code]} badge />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" fontWeight={600}>
            {t(`detail.quality.issues.${issue.code}.title`, { count })}
          </Typography>
          <QualitySeverityChip severity={issue.severity} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t(`detail.quality.issues.${issue.code}.desc`, { count })}
        </Typography>
      </Box>
    </Stack>
  );
}

function FileReport({ file, showName }: { file: FileQuality; showName: boolean }) {
  const { t, i18n } = useTranslation("models");
  const number = (value: number) => value.toLocaleString(i18n.language);
  const stats =
    file.triangles !== null && file.size
      ? [
          t("detail.quality.triangles", { count: file.triangles, formatted: number(file.triangles) }),
          t("detail.quality.bodies", { count: file.shells ?? 0 }),
          t("detail.quality.size", {
            x: number(Math.round(file.size[0])),
            y: number(Math.round(file.size[1])),
            z: number(Math.round(file.size[2])),
          }),
        ].join(" · ")
      : null;

  return (
    <Box>
      {showName && (
        <Typography variant="subtitle2" noWrap title={file.filename} sx={{ mb: 0.5 }}>
          {file.filename}
        </Typography>
      )}
      {file.status === "good" && (
        <Stack direction="row" spacing={1.25} alignItems="center">
          <CheckCircleRoundedIcon fontSize="small" sx={{ color: "success.main" }} />
          <Typography variant="body2" fontWeight={600}>
            {t("detail.quality.noIssues")}
          </Typography>
        </Stack>
      )}
      {file.status === "issues" && (
        <Stack spacing={2} component="ul" sx={{ m: 0, p: 0, pb: 0.75, listStyle: "none" }}>
          {file.issues.map((issue) => (
            <IssueRow key={issue.code} issue={issue} />
          ))}
        </Stack>
      )}
      {(file.status === "skipped" || file.status === "unchecked" || file.status === "checking") && (
        <Stack direction="row" spacing={1.25} alignItems="center">
          <HelpOutlineRoundedIcon fontSize="small" sx={{ color: "text.disabled" }} />
          <Typography variant="body2" color="text.secondary">
            {t(file.status === "skipped" ? "detail.quality.skipped" : "detail.quality.notYet")}
          </Typography>
        </Stack>
      )}
      {stats && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
          {stats}
        </Typography>
      )}
    </Box>
  );
}

/** What the printability check found in each of the model's files. */
export default function QualityReportDialog({ open, quality, isAdmin, onClose }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const showNames = quality.files.length > 1;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("models:detail.quality.dialogTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          {quality.files.map((file) => (
            <FileReport key={file.plate_id} file={file} showName={showNames} />
          ))}
          {quality.status === "issues" && (
            <Typography variant="caption" color="text.secondary">
              {t("models:detail.quality.slicerNote")}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {isAdmin && (
          <Button
            startIcon={<SettingsOutlinedIcon fontSize="small" />}
            onClick={() => navigate("/admin-rendering#quality-checks")}
            sx={{ mr: "auto" }}
          >
            {t("models:detail.quality.manageSettings")}
          </Button>
        )}
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
