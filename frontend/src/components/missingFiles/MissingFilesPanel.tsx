import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import type { ModelRepairAction } from "../../api/modelRepair";
import HelpTip from "../HelpTip";
import ProviderBadge from "../ProviderBadge";
import RollingNumber from "../RollingNumber";
import { SectionLabel } from "../Layout/ConfigurationDialog/parts";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import { useModelRepair } from "../Layout/ModelRepairContext";

// What the library is missing and the two ways out of it, shown both in the dialog that comes up on its own and in
// the models page's Repair section. Each action asks again before it starts: one fetches a library's worth of
// files from the sites it came from, the other deletes models for good.

/** Past this many, a re-import is a long haul the sites may rate-limit. */
const MANY = 50;

function Stat({ count, label, tone }: { count: number; label: string; tone?: "warning" | "error" }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        opacity: count ? 1 : 0.55,
      }}
    >
      <Typography variant="h6" sx={{ lineHeight: 1.2, color: count && tone ? `${tone}.main` : "text.primary" }}>
        <RollingNumber value={count} />
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {label}
      </Typography>
    </Box>
  );
}

function ActionTile({
  icon,
  title,
  detail,
  destructive,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      disabled={disabled}
      onClick={onClick}
      sx={{
        flex: 1,
        minWidth: 0,
        p: 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        textAlign: "left",
        alignItems: "flex-start",
        transition: "border-color 150ms, background-color 150ms, transform 150ms",
        "&:hover:not(.Mui-disabled)": {
          borderColor: destructive ? "error.main" : "primary.main",
          bgcolor: (theme) => (destructive ? theme.palette.error.main : theme.palette.primary.main) + "0f",
          transform: "translateY(-1px)",
        },
        "&.Mui-disabled": { opacity: 0.5 },
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Box sx={{ color: destructive ? "error.main" : "primary.main", display: "flex", mt: 0.25 }}>{icon}</Box>
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">{title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        </Stack>
      </Stack>
    </ButtonBase>
  );
}

/** `onStarted` lets the host (the dialog) close itself once a run is going. */
export default function MissingFilesPanel({ onStarted }: { onStarted?: () => void }) {
  const { t } = useTranslation(["app", "common"]);
  const { summary, refresh, running, start } = useModelRepair();
  const confirm = useConfirm();
  const showToast = useToast();
  const [busy, setBusy] = useState<ModelRepairAction | "scan" | null>(null);

  const broken = summary?.broken ?? 0;

  const begin = async (action: ModelRepairAction) => {
    const reimport = action === "reimport";
    const waiting = summary?.grab ?? 0;
    // A re-import only speaks for the models this Thingport can fetch itself; the rest are parked for Grab.
    const count = reimport ? (summary?.server ?? 0) : broken;
    const confirmed = await confirm({
      title: t(`missingFiles.confirm.${action}.title`, { count }),
      message: reimport ? (
        <>
          {t("missingFiles.confirm.reimport.message", { count })}
          {waiting > 0 && ` ${t("missingFiles.confirm.reimport.queued", { count: waiting })}`}
        </>
      ) : (
        t("missingFiles.confirm.delete.message", { count })
      ),
      confirmLabel: t(`missingFiles.confirm.${action}.confirm`),
      destructive: !reimport,
    });
    if (!confirmed) return;
    setBusy(action);
    try {
      await start(action);
      onStarted?.();
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : t("missingFiles.startFailed"), severity: "error" });
    } finally {
      setBusy(null);
    }
  };

  const rescan = async () => {
    setBusy("scan");
    try {
      await refresh(true);
    } finally {
      setBusy(null);
    }
  };

  if (!summary) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 4 }}>
        <CircularProgress size={22} />
        <Typography variant="caption" color="text.secondary">
          {t("missingFiles.checking")}
        </Typography>
      </Stack>
    );
  }

  if (!broken) {
    return (
      <Stack alignItems="center" spacing={1.25} sx={{ py: 4, textAlign: "center" }}>
        <TaskAltIcon sx={{ fontSize: 34, color: "success.main" }} />
        <Typography variant="subtitle2">{t("missingFiles.allWell")}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t("missingFiles.allWellDetail", { count: summary.total })}
        </Typography>
        <Button size="small" startIcon={<RefreshIcon fontSize="small" />} onClick={() => void rescan()}>
          {t("missingFiles.checkAgain")}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        {t("missingFiles.lead", { count: broken })}
        <HelpTip text={t("missingFiles.leadHelp")} />
      </Typography>

      <Stack direction="row" spacing={1}>
        <Stat count={broken} label={t("missingFiles.stats.broken")} tone="error" />
        <Stat count={summary.server} label={t("missingFiles.stats.server")} />
        <Stat count={summary.grab} label={t("missingFiles.stats.grab")} tone="warning" />
        <Stat count={summary.no_source} label={t("missingFiles.stats.noSource")} tone="warning" />
      </Stack>

      {summary.by_provider.length > 0 && (
        <Box>
          <SectionLabel>{t("missingFiles.fromSites")}</SectionLabel>
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
            {summary.by_provider.map(({ provider, count }) => (
              <Stack key={provider ?? "upload"} direction="row" spacing={0.75} alignItems="center">
                <ProviderBadge provider={provider} size={22} interactive={false} />
                <Typography variant="caption" color="text.secondary">
                  {count}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      {summary.server >= MANY && (
        <Alert severity="info">{t("missingFiles.manyWarning", { count: summary.server })}</Alert>
      )}
      {running && <Alert severity="info">{t("missingFiles.alreadyRunning")}</Alert>}

      <Box>
        <SectionLabel>{t("missingFiles.whatNow")}</SectionLabel>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <ActionTile
            icon={<CloudDownloadOutlinedIcon />}
            title={t("missingFiles.actions.reimport.title")}
            detail={
              summary.server
                ? t("missingFiles.actions.reimport.detail", { count: summary.server })
                : t("missingFiles.actions.reimport.none")
            }
            disabled={running || busy !== null || summary.server + summary.grab === 0}
            onClick={() => void begin("reimport")}
          />
          <ActionTile
            icon={<DeleteOutlineIcon />}
            title={t("missingFiles.actions.delete.title")}
            detail={t("missingFiles.actions.delete.detail", { count: broken })}
            destructive
            disabled={running || busy !== null}
            onClick={() => void begin("delete")}
          />
        </Stack>
      </Box>

      <Stack direction="row" justifyContent="flex-end">
        <Button
          size="small"
          startIcon={busy === "scan" ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
          disabled={busy !== null}
          onClick={() => void rescan()}
        >
          {t("missingFiles.checkAgain")}
        </Button>
      </Stack>
    </Stack>
  );
}
