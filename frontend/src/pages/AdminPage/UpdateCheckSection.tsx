import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, FRONTEND_GIT_SHA } from "../../api/settings";
import SectionHeader from "../../components/SectionHeader";

type Props = {
  onUnauthorized?: () => void;
};

type Status =
  | { kind: "checking" }
  | { kind: "unknown" }
  | { kind: "error" }
  | { kind: "up-to-date" }
  | { kind: "outdated"; backend: boolean; frontend: boolean };

// Runs automatically on every visit to this page -- see versionService.ts (backend) for what
// "latest" is compared against. Both this bundle's own commit (FRONTEND_GIT_SHA, inlined at
// build time) and the backend's are only ever set on a published Docker image; a local dev
// build has neither, so the check reports "unknown" instead of a false "outdated". Lives on the
// Administration hub (not AdminSettingsPage) since it's a hub-level status, not a per-instance
// setting -- still under the "adminSettings" i18n namespace though, like the hub's own section
// labels (see AdminPage's SECTIONS), to avoid churning translations for a page move.
export default function UpdateCheckSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [status, setStatus] = React.useState<Status>({ kind: "checking" });

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await settingsApi.getVersionCheck();
        if (!active) return;
        if (!data.backend_sha || !FRONTEND_GIT_SHA) {
          setStatus({ kind: "unknown" });
          return;
        }
        const backendOutdated = data.latest_backend_sha !== null && data.latest_backend_sha !== data.backend_sha;
        const frontendOutdated = data.latest_frontend_sha !== null && data.latest_frontend_sha !== FRONTEND_GIT_SHA;
        setStatus(
          backendOutdated || frontendOutdated
            ? { kind: "outdated", backend: backendOutdated, frontend: frontendOutdated }
            : { kind: "up-to-date" },
        );
      } catch (err) {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setStatus({ kind: "error" });
      }
    })();
    return () => { active = false; };
  }, [onUnauthorized]);

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.updateCheck.heading")}
        subtitle={t("adminSettings.updateCheck.subtitle")}
      />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        {status.kind === "checking" && (
          <Stack direction="row" alignItems="center" spacing={1}>
            <CircularProgress size={14} />
            <Typography variant="body2" color="text.secondary">
              {t("adminSettings.updateCheck.checking")}
            </Typography>
          </Stack>
        )}
        {status.kind === "unknown" && (
          <Typography variant="body2" color="text.secondary">
            {t("adminSettings.updateCheck.unknown")}
          </Typography>
        )}
        {status.kind === "error" && (
          <Typography variant="body2" color="text.secondary">
            {t("adminSettings.updateCheck.failed")}
          </Typography>
        )}
        {status.kind === "up-to-date" && (
          <Alert severity="success" variant="outlined">
            {t("adminSettings.updateCheck.upToDate")}
          </Alert>
        )}
        {status.kind === "outdated" && (
          <Alert severity="info">
            <AlertTitle>{t("adminSettings.updateCheck.availableTitle")}</AlertTitle>
            <Box component="ul" sx={{ mt: 0.5, mb: 1, pl: 2.5 }}>
              {status.backend && (
                <li><Typography variant="body2">{t("adminSettings.updateCheck.backendOutdated")}</Typography></li>
              )}
              {status.frontend && (
                <li><Typography variant="body2">{t("adminSettings.updateCheck.frontendOutdated")}</Typography></li>
              )}
            </Box>
            <Typography variant="body2">{t("adminSettings.updateCheck.howTo")}</Typography>
          </Alert>
        )}
      </Paper>
    </Stack>
  );
}
