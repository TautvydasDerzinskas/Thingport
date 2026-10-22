import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DashboardCustomizeOutlinedIcon from "@mui/icons-material/DashboardCustomizeOutlined";
import ToggleOnOutlinedIcon from "@mui/icons-material/ToggleOnOutlined";
import type { DashboardConfigApi } from "../../hooks/useDashboardConfig";
import SectionedDialog from "../../components/SectionedDialog";
import SelectableTile from "../../components/controls/SelectableTile";
import HelpTip from "../../components/HelpTip";
import PanelSketch from "./PanelSketch";
import TemplatesSection from "./TemplatesSection";
import { addWidget, removeWidget, templateName, templateWidgets } from "./templates";
import { DASHBOARD_WIDGETS } from "./widgets";

export type CustomizeSection = "templates" | "panels";

type Props = {
  open: boolean;
  /** The section it opens on. */
  initialSection?: CustomizeSection;
  dashboard: DashboardConfigApi;
  onClose: () => void;
};

/** Every choice applies straight away, so the dashboard behind updates as the user goes. */
export default function DashboardCustomizeDialog({ open, initialSection = "templates", dashboard, onClose }: Props) {
  const { t } = useTranslation("app");
  const [section, setSection] = useState<CustomizeSection>(initialSection);
  const { config, template, update, updateTemplate } = dashboard;
  const shown = templateWidgets(template);

  // Kept while closing, so the section doesn't switch during the fade.
  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);

  const sections = [
    {
      id: "templates" as const,
      label: t("dashboard.widgets.sections.templates"),
      icon: <DashboardCustomizeOutlinedIcon fontSize="small" />,
    },
    {
      id: "panels" as const,
      label: t("dashboard.widgets.sections.panels"),
      icon: <ToggleOnOutlinedIcon fontSize="small" />,
    },
  ];

  return (
    <SectionedDialog
      open={open}
      onClose={onClose}
      title={t("dashboard.widgets.title")}
      sections={sections}
      section={section}
      onSectionChange={setSection}
    >
      {section === "templates" && (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="subtitle2">{t("dashboard.templates.heading")}</Typography>
            <HelpTip text={t("dashboard.templates.help")} />
          </Stack>
          <TemplatesSection config={config} onChange={update} />
        </Stack>
      )}
      {section === "panels" && (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="subtitle2">
              {t("dashboard.widgets.panelsOf", { name: templateName(t, template) })}
            </Typography>
            <HelpTip text={t("dashboard.widgets.subtitle")} />
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
            {DASHBOARD_WIDGETS.map((widget) => {
              const enabled = shown.has(widget.id);
              return (
                <SelectableTile
                  key={widget.id}
                  selected={enabled}
                  dimWhenOff
                  label={t(widget.labelKey)}
                  onClick={() =>
                    updateTemplate((current) =>
                      enabled ? removeWidget(current, widget.id) : addWidget(current, widget.id),
                    )
                  }
                >
                  <PanelSketch kind={widget.sketch} />
                </SelectableTile>
              );
            })}
          </Box>
        </Stack>
      )}
    </SectionedDialog>
  );
}
