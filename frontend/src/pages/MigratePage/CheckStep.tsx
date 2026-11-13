import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import type { MigrateCounts, MigrateRun, MigrateStep } from "../../api/migrate";
import HelpTip from "../../components/HelpTip";
import { errorDetails, errorText, formatBytes, k } from "./parts";

const PREPARING: MigrateStep[] = ["restoring", "checking", "upgrading", "files"];
// Online, the old instance's dump comes first.
const PREPARING_ONLINE: MigrateStep[] = ["downloading", ...PREPARING];
const COUNTS: (keyof MigrateCounts)[] = [
  "people",
  "models",
  "files",
  "collections",
  "designs",
  "widgets",
  "syncs",
  "signIns",
];

type Props = {
  run: MigrateRun;
  onChangeFolder: (folder: string) => Promise<void>;
};

/** What preparing found: the old instance's release, what it holds and anything in the way. */
export default function CheckStep({ run, onChangeFolder }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [editing, setEditing] = React.useState(false);
  const [folder, setFolder] = React.useState(run.plan.folder);
  const [checking, setChecking] = React.useState(false);

  if (run.status === "preparing") {
    const steps = run.source === "thingport-online" ? PREPARING_ONLINE : PREPARING;
    const current = run.progress?.step ?? steps[0];
    const at = steps.indexOf(current);
    return (
      <Stack spacing={1.25} aria-live="polite">
        {steps.map((step, index) => (
          <Stack key={step} direction="row" spacing={1.25} alignItems="center" sx={{ opacity: index > at ? 0.45 : 1 }}>
            {index < at ? (
              <CheckCircleOutlineIcon color="success" fontSize="small" aria-hidden />
            ) : index === at ? (
              <CircularProgress size={18} aria-hidden />
            ) : (
              <Box sx={{ width: 20 }} />
            )}
            <Typography variant="body2">
              {t(k(`check.steps.${step}`))}
              {step === "downloading" && index === at && (run.progress?.done ?? 0) > 0 && (
                <Typography component="span" variant="body2" color="text.secondary">
                  {` · ${formatBytes(run.progress!.done)}`}
                </Typography>
              )}
            </Typography>
          </Stack>
        ))}
        {current === "files" && run.progress && run.progress.total > 0 && (
          <LinearProgress
            variant="determinate"
            value={(run.progress.done / run.progress.total) * 100}
            sx={{ borderRadius: 1 }}
            aria-hidden
          />
        )}
      </Stack>
    );
  }

  if (run.status === "failed" && !run.started_at) {
    const details = errorDetails(run.error);
    return (
      <Alert severity="error">
        <Typography variant="body2" fontWeight={600}>
          {t(k("check.failed"))}
        </Typography>
        <Typography variant="body2">{errorText(t, run.error)}</Typography>
        {details && (
          <Box
            component="pre"
            sx={{ mt: 1, mb: 0, fontSize: "0.75rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {details}
          </Box>
        )}
      </Alert>
    );
  }

  const { plan } = run;
  const counts = plan.counts;
  const missing = plan.missingFiles ?? 0;
  const allMissing = Boolean(counts && counts.files > 0 && missing >= counts.files);
  const stays = Object.entries(plan.staysBehind ?? {}).filter(([, count]) => (count ?? 0) > 0);

  const saveFolder = async () => {
    setChecking(true);
    try {
      await onChangeFolder(folder);
      setEditing(false);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CheckCircleOutlineIcon color="success" aria-hidden />
        <Box>
          <Typography variant="body1" fontWeight={600}>
            {plan.version ? t(k("check.release"), { version: plan.version }) : t(k("check.olderRelease"))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {plan.changes?.added ? t(k("check.changes"), { count: plan.changes.added }) : t(k("check.upToDate"))}
          </Typography>
        </Box>
      </Stack>

      {counts && (
        <Box
          sx={{
            display: "grid",
            gap: 1,
            gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
          }}
        >
          {COUNTS.map((key) => (
            <Box key={key} sx={{ px: 1.5, py: 1, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <Typography variant="h6" component="p" sx={{ lineHeight: 1.2 }}>
                {counts[key].toLocaleString()}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t(k(`check.counts.${key}`), { count: counts[key] })}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {run.source === "thingport" && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <FolderOutlinedIcon fontSize="small" color="action" aria-hidden />
          {editing ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
              <TextField
                size="small"
                fullWidth
                label={t(k("source.folder"))}
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                disabled={checking}
                slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
              />
              <Button onClick={() => void saveFolder()} disabled={checking || !folder.trim()} sx={{ flexShrink: 0 }}>
                {checking ? <CircularProgress size={18} /> : t(k("check.checkAgain"))}
              </Button>
            </Stack>
          ) : (
            <>
              <Typography variant="body2" sx={{ fontFamily: "monospace", overflowWrap: "anywhere", flex: 1 }}>
                {plan.folder}
              </Typography>
              <Button size="small" onClick={() => setEditing(true)} sx={{ flexShrink: 0 }}>
                {t(k("check.changeFolder"))}
              </Button>
            </>
          )}
        </Stack>
      )}

      {allMissing ? (
        <Alert severity="error">{t(k("check.allMissing"))}</Alert>
      ) : missing > 0 ? (
        <Alert severity="warning">{t(k("check.missingFiles"), { count: missing, total: counts?.files ?? 0 })}</Alert>
      ) : null}

      {(plan.toolsNotHere?.length ?? 0) > 0 && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => navigate("/admin-tools")}>
              {t(k("check.openTools"))}
            </Button>
          }
        >
          {t(k("check.toolsNotHere"), { tools: plan.toolsNotHere!.map((tool) => tool.name).join(", ") })}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary" component="div">
        {t(k("check.staysBehind"))}
        <HelpTip
          text={t(k("check.staysBehindHelp"))}
          content={
            <Stack spacing={0.5}>
              <Typography variant="body2">{t(k("check.staysBehindHelp"))}</Typography>
              {stays.map(([kind, count]) => (
                <Typography key={kind} variant="body2">
                  {t(k(`check.stays.${kind}`), { count })}
                </Typography>
              ))}
            </Stack>
          }
        />
      </Typography>
    </Stack>
  );
}

/** Whether the check lets it go on: ready, with some of its files in the folder. */
export function checkPassed(run: MigrateRun | null): boolean {
  if (!run || run.status !== "ready") return false;
  const files = run.plan.counts?.files ?? 0;
  return !(files > 0 && (run.plan.missingFiles ?? 0) >= files);
}

/** Whether the run can be started as it is now: checked, and with no new check of its folder under way. */
export function canStart(run: MigrateRun | null, rechecking: boolean): boolean {
  if (!run || rechecking) return false;
  return run.status === "failed" ? run.can_resume : checkPassed(run);
}
