import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { widgetsApi, type WidgetSources } from "../../api/widgets";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";
import { resetCustomWidgets } from "../../hooks/useCustomWidgets";
import WidgetSourceTile from "./WidgetSourceTile";
import WidgetUsage from "./WidgetUsage";

type Props = {
  onUnauthorized?: () => void;
};

/** Which custom widgets users may add, and the ones they have. */
export default function DashboardAdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const [sources, setSources] = React.useState<WidgetSources | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    widgetsApi
      .getSources()
      .then((value) => active && setSources(value))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const toggle = async (source: keyof WidgetSources, next: boolean) => {
    if (!sources) return;
    const previous = sources;
    setSources({ ...sources, [source]: next });
    setSaving(true);
    try {
      setSources(await widgetsApi.setSources({ [source]: next }));
      // The admin's own dashboard loads them again with the new setting.
      resetCustomWidgets();
    } catch (err) {
      setSources(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.dashboard.sources.failed"), severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={4}>
      <SectionHeader title={t("adminSettings.dashboard.heading")} subtitle={t("adminSettings.dashboard.subtitle")} />
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">
          {t("adminSettings.dashboard.sources.heading")}
          <HelpTip text={t("adminSettings.dashboard.sources.help")} />
        </Typography>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 320px))" } }}>
          {(["own", "community"] as const).map((source) => (
            <WidgetSourceTile
              key={source}
              kind={source}
              label={t(`adminSettings.dashboard.sources.${source}.label`)}
              description={t(`adminSettings.dashboard.sources.${source}.${sources?.[source] === false ? "off" : "on"}`)}
              checked={sources ? sources[source] : null}
              disabled={saving}
              onChange={(next) => void toggle(source, next)}
            />
          ))}
        </Box>
      </Stack>
      <WidgetUsage communityOn={sources?.community !== false} onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
