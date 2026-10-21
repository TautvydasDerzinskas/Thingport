import React from "react";
import { useTranslation } from "react-i18next";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type McpAccess } from "../../api/settings";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";

type Props = {
  onUnauthorized?: () => void;
};

const LEVELS: McpAccess[] = ["off", "read", "write"];

/** What API tokens may do at /api/mcp. Each user still picks their own token's tools within it. */
export default function McpSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const [access, setAccess] = React.useState<McpAccess>("write");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await settingsApi.getMcp();
        if (active) setAccess(data.access);
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const select = async (next: McpAccess) => {
    if (next === access || saving) return;
    const previous = access;
    setAccess(next);
    setSaving(true);
    try {
      setAccess((await settingsApi.updateMcp(next)).access);
    } catch (err) {
      setAccess(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.mcp.failed"), severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.mcp.heading")} subtitle={t("adminSettings.mcp.subtitle")} />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={0.75} alignItems="flex-start">
          <Typography variant="body2" fontWeight={600}>
            {t("adminSettings.mcp.accessLabel")}
            <HelpTip text={t("adminSettings.mcp.help")} />
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Segmented
              label={t("adminSettings.mcp.accessLabel")}
              value={access}
              onChange={(next) => void select(next)}
              disabled={loading || saving}
              options={LEVELS.map((level) => ({ value: level, label: t(`adminSettings.mcp.levels.${level}`) }))}
            />
            {saving && <CircularProgress size={14} />}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {t(`adminSettings.mcp.levelHelp.${access}`)}
          </Typography>
        </Stack>
      </Paper>
    </Stack>
  );
}
