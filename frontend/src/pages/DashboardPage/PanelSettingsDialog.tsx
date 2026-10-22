import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { DashboardTemplate, DashboardWidgetId } from "../../api/settings";
import Segmented from "../../components/controls/Segmented";
import { resolveSettings, widgetById, type ResolvedSettings } from "./widgets";

type Props = {
  /** The panel's widgets that have options; null while closed. */
  widgets: DashboardWidgetId[] | null;
  template: DashboardTemplate;
  onChange: (id: DashboardWidgetId, values: ResolvedSettings) => void;
  onClose: () => void;
};

/** A panel's options. Each applies straight away, so the panel behind updates as the user goes. */
export default function PanelSettingsDialog({ widgets, template, onChange, onClose }: Props) {
  const { t } = useTranslation("app");
  const shown = (widgets ?? []).flatMap((id) => widgetById(id) ?? []);
  const resolved = (id: DashboardWidgetId) => resolveSettings(widgetById(id)!, template.settings?.[id]);
  const changed = shown.some((widget) => template.settings?.[widget.id]);
  const title =
    shown.length === 1
      ? t("dashboard.settings.title", { name: t(shown[0].labelKey) })
      : t("dashboard.settings.titlePanel");

  return (
    <Dialog open={widgets !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          {shown.map((widget) => {
            const values = resolved(widget.id);
            const set = (key: string, value: string | boolean) => onChange(widget.id, { ...values, [key]: value });
            return (
              <Stack key={widget.id} spacing={1.5}>
                {shown.length > 1 && (
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "primary.main" }}>
                    {widget.icon}
                    <Typography variant="subtitle2" color="text.primary">
                      {t(widget.labelKey)}
                    </Typography>
                  </Stack>
                )}
                {widget.settings!.map((setting) => (
                  <Box
                    key={setting.key}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                      minHeight: 38,
                    }}
                  >
                    <Typography variant="body2" id={`${widget.id}-${setting.key}`}>
                      {t(setting.labelKey)}
                    </Typography>
                    {setting.kind === "choice" ? (
                      <Segmented
                        label={t(setting.labelKey)}
                        value={values[setting.key] as string}
                        options={setting.options.map((option) => ({
                          value: option.value,
                          label: option.label ?? t(option.labelKey ?? ""),
                        }))}
                        onChange={(value) => set(setting.key, value)}
                      />
                    ) : (
                      <Switch
                        checked={values[setting.key] === true}
                        onChange={(event) => set(setting.key, event.target.checked)}
                        slotProps={{ input: { "aria-labelledby": `${widget.id}-${setting.key}` } }}
                      />
                    )}
                  </Box>
                ))}
              </Stack>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, pb: 2 }}>
        <Button
          color="inherit"
          disabled={!changed}
          onClick={() => shown.forEach((widget) => onChange(widget.id, resolveSettings(widget, undefined)))}
        >
          {t("dashboard.settings.reset")}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t("dashboard.settings.done")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
